import session from 'express-session';
import { Router } from 'express';
import crypto from 'crypto';
import axios from 'axios';

// ---------------------------------------------------------------------------
// Config — derived from .env. The org-scoped Identity endpoints are used for
// the Authorization Code flow (the root token URL only works for
// client_credentials). Both can be overridden explicitly via env.
// ---------------------------------------------------------------------------
const {
  VITE_UIPATH_TENANT_URL,
  VITE_UIPATH_CLIENT_ID,
  VITE_UIPATH_CLIENT_SECRET,
  UIPATH_OAUTH_AUTHORIZE_URL,
  UIPATH_OAUTH_TOKEN_URL,
  UIPATH_OAUTH_REDIRECT_URI,
} = process.env;

const SCOPE =
  process.env.VITE_UIPATH_SCOPE ||
  'openid profile offline_access OR.Execution OR.Jobs OR.Folders';
const REDIRECT_URI =
  UIPATH_OAUTH_REDIRECT_URI || 'http://localhost:5173/auth/callback';

// Parse org + tenant out of the tenant URL so we can build the Identity URLs
// and report them to the frontend.
let org = '';
let tenant = '';
let originBase = 'https://cloud.uipath.com';
try {
  const parsed = new URL(VITE_UIPATH_TENANT_URL);
  originBase = parsed.origin;
  [org = '', tenant = ''] = parsed.pathname.split('/').filter(Boolean);
} catch {
  console.warn('⚠️  Could not parse VITE_UIPATH_TENANT_URL to derive org/tenant.');
}

const IDENTITY_BASE = `${originBase}/${org}/identity_`;
const AUTHORIZE_URL = UIPATH_OAUTH_AUTHORIZE_URL || `${IDENTITY_BASE}/connect/authorize`;
const TOKEN_URL = UIPATH_OAUTH_TOKEN_URL || `${IDENTITY_BASE}/connect/token`;

export const authConfig = { org, tenant, AUTHORIZE_URL, TOKEN_URL, REDIRECT_URI, SCOPE };

// ---------------------------------------------------------------------------
// Small crypto helpers (PKCE + state) and a JWT payload decoder.
// ---------------------------------------------------------------------------
const b64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = () => b64url(crypto.randomBytes(32));
const challengeFor = (verifier) =>
  b64url(crypto.createHash('sha256').update(verifier).digest());

// Decode a JWT payload WITHOUT verifying the signature — safe here because the
// token comes straight from the token endpoint over TLS, and it's used only to
// display the user's name.
const decodeJwt = (jwt) => {
  try {
    const payload = jwt.split('.')[1];
    const json = Buffer.from(
      payload.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf8');
    return JSON.parse(json);
  } catch {
    return {};
  }
};

const postToken = async (params) => {
  const { data } = await axios.post(TOKEN_URL, new URLSearchParams(params), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return data;
};

// Fetch user info from the standard OIDC UserInfo endpoint
const getUserInfo = async (accessToken) => {
  try {
    const userInfoUrl = `${IDENTITY_BASE}/connect/userinfo`;
    const { data } = await axios.get(userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });
    return data;
  } catch (err) {
    console.warn('⚠️  Could not fetch UserInfo:', err.response?.data || err.message);
    return {};
  }
};

const saveSession = (req) =>
  new Promise((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve()))
  );

// Persist tokens; keep the previous refresh token if a rotation didn't return
// a new one (UiPath rotation behaviour varies).
const storeTokens = (req, data) => {
  const prev = req.session.tokens || {};
  req.session.tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || prev.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
};

// ---------------------------------------------------------------------------
// Session middleware. SameSite=Lax is required: the OAuth callback is a
// cross-site top-level GET and must still carry the cookie (Strict would drop
// it; None would need Secure/https). secure only in production.
// ---------------------------------------------------------------------------
const isProd = process.env.NODE_ENV === 'production';

export const sessionMiddleware = session({
  name: 'connect.sid',
  secret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 12 * 60 * 60 * 1000,
  },
});

// ---------------------------------------------------------------------------
// Token access + refresh, with a per-session mutex so the dashboard's
// concurrent / 5s-polling requests don't all refresh at once (which could
// invalidate a rotated refresh token and log the user out).
// ---------------------------------------------------------------------------
const refreshInFlight = new Map();

const unauthorized = (message) => {
  const err = new Error(message);
  err.status = 401;
  return err;
};

export const getUserToken = async (req) => {
  const tokens = req.session.tokens;
  if (!tokens?.access_token) throw unauthorized('Not authenticated');

  // Still valid (with a 60s safety margin)?
  if (Date.now() < tokens.expires_at - 60_000) return tokens.access_token;

  const sid = req.sessionID;
  if (!refreshInFlight.has(sid)) {
    const p = (async () => {
      if (!tokens.refresh_token) throw unauthorized('Session expired');
      const data = await postToken({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: VITE_UIPATH_CLIENT_ID,
        client_secret: VITE_UIPATH_CLIENT_SECRET,
      });
      storeTokens(req, data);
      await saveSession(req);
      return req.session.tokens.access_token;
    })().finally(() => refreshInFlight.delete(sid));
    refreshInFlight.set(sid, p);
  }

  try {
    return await refreshInFlight.get(sid);
  } catch {
    await new Promise((resolve) => req.session.destroy(() => resolve()));
    throw unauthorized('Session expired');
  }
};

// Express middleware guard for the /api/uipath/* routes.
export const requireAuth = async (req, res, next) => {
  try {
    req.accessToken = await getUserToken(req);
    next();
  } catch (err) {
    res.status(err.status || 401).json({ authenticated: false, error: err.message });
  }
};

// ---------------------------------------------------------------------------
// OAuth routes: /auth/login, /auth/callback, /auth/logout, /auth/me
// ---------------------------------------------------------------------------
export const authRouter = Router();

authRouter.get('/login', async (req, res) => {
  const state = randomString();
  const codeVerifier = randomString();
  const nonce = randomString();

  req.session.oauth = { state, codeVerifier, nonce };
  await saveSession(req);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: VITE_UIPATH_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
    nonce,
    code_challenge: challengeFor(codeVerifier),
    code_challenge_method: 'S256',
  });
  res.redirect(`${AUTHORIZE_URL}?${params.toString()}`);
});

authRouter.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) return res.status(400).send(`Login failed: ${error_description || error}`);

  const saved = req.session.oauth;
  if (!code || !state || !saved || state !== saved.state) {
    return res.status(400).send('Invalid or expired login attempt. Please try logging in again.');
  }

  try {
    const data = await postToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: VITE_UIPATH_CLIENT_ID,
      client_secret: VITE_UIPATH_CLIENT_SECRET,
      code_verifier: saved.codeVerifier,
    });

    const idClaims = data.id_token ? decodeJwt(data.id_token) : {};

    // Fetch additional user info from UserInfo endpoint using access token
    const userInfo = await getUserInfo(data.access_token);

    const user = {
      name:
      userInfo.first_name,
      email: userInfo.email || idClaims.email || null,
      sub: idClaims.sub || null,
    };

    await new Promise((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );
    storeTokens(req, data);
    req.session.user = user;
    await saveSession(req);

    res.redirect('/');
  } catch (err) {
    console.error('❌ OAuth token exchange failed:', err.response?.data || err.message);
    res.status(500).send('Login failed during token exchange. Check the server logs.');
  }
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

authRouter.get('/me', (req, res) => {
  if (req.session.tokens && req.session.user) {
    return res.json({ authenticated: true, user: req.session.user, org, tenant });
  }
  res.json({ authenticated: false });
});
