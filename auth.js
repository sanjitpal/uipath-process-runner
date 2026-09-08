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
export const getRedirectUri = (req) => {
  // 1. If we have an incoming request from a browser/client on a hosted domain
  if (req) {
    const host = req.get('x-forwarded-host') || req.get('host');
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      return `${proto}://${host}/auth/callback`;
    }
  }

  // 2. If running in Cloud Run environment (APP_URL set by container platform)
  if (process.env.APP_URL && !process.env.APP_URL.includes('localhost')) {
    return `${process.env.APP_URL.replace(/\/$/, '')}/auth/callback`;
  }

  // 3. Explicit override in env (only if not a stale localhost when running in cloud)
  if (process.env.UIPATH_OAUTH_REDIRECT_URI) {
    const isCloud = process.env.APP_URL && !process.env.APP_URL.includes('localhost');
    if (!isCloud || !process.env.UIPATH_OAUTH_REDIRECT_URI.includes('localhost')) {
      return process.env.UIPATH_OAUTH_REDIRECT_URI;
    }
  }

  // 4. Fallback to current request or localhost:3000
  if (req) {
    const host = req.get('host') || 'localhost:3000';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    return `${proto}://${host}/auth/callback`;
  }
  return 'http://localhost:3000/auth/callback';
};

const REDIRECT_URI = getRedirectUri();

// Parse org + tenant out of the tenant URL so we can build the Identity URLs
// and report them to the frontend.
let org = '';
let tenant = '';
let originBase = 'https://cloud.uipath.com';
try {
  if (VITE_UIPATH_TENANT_URL) {
    const parsed = new URL(VITE_UIPATH_TENANT_URL);
    originBase = parsed.origin;
    [org = '', tenant = ''] = parsed.pathname.split('/').filter(Boolean);
  }
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

const OAUTH_SECRET = process.env.SESSION_SECRET || 'uipath-orchestrator-oauth-secret-v1';

export const createOAuthState = (data) => {
  const payloadStr = JSON.stringify({
    v: data.codeVerifier,
    r: data.redirectUri,
    n: data.nonce,
    t: data.createdAt || Date.now(),
    s: data.seed || randomString().slice(0, 10),
  });
  const dataB64 = Buffer.from(payloadStr).toString('base64url');
  const sig = crypto.createHmac('sha256', OAUTH_SECRET).update(dataB64).digest('base64url');
  return `${dataB64}.${sig}`;
};

export const unpackOAuthState = (stateStr) => {
  if (!stateStr || typeof stateStr !== 'string') return null;
  const dotIdx = stateStr.lastIndexOf('.');
  if (dotIdx === -1) return null;

  const dataB64 = stateStr.slice(0, dotIdx);
  const sig = stateStr.slice(dotIdx + 1);
  if (!dataB64 || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', OAUTH_SECRET).update(dataB64).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const raw = Buffer.from(dataB64, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    // Allow up to 60 minutes for completing login
    if (parsed.t && Date.now() - parsed.t > 60 * 60 * 1000) {
      console.warn('⚠️  OAuth state has expired (>60m)');
      return null;
    }
    return {
      codeVerifier: parsed.v,
      redirectUri: parsed.r,
      nonce: parsed.n,
      createdAt: parsed.t,
    };
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Session middleware. SameSite=none and secure=true in hosted environment
// (required for cross-origin iframe preview in AI Studio).
// ---------------------------------------------------------------------------
const isSecure = process.env.NODE_ENV === 'production' || !!process.env.APP_URL;

export const sessionMiddleware = session({
  name: 'connect.sid',
  secret: process.env.SESSION_SECRET || 'uipath-orchestrator-oauth-secret-v1',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    sameSite: isSecure ? 'none' : 'lax',
    secure: isSecure,
    maxAge: 12 * 60 * 60 * 1000,
  },
});

// ---------------------------------------------------------------------------
// Token access + refresh, with a per-session mutex so the dashboard's
// concurrent / 5s-polling requests don't all refresh at once (which could
// invalidate a rotated refresh token and log the user out).
// ---------------------------------------------------------------------------
const refreshInFlight = new Map();

// In-memory store for pending PKCE verifiers by state (valid for 15 minutes)
// This guarantees OAuth callback succeeds even if cross-site/partitioned cookies are dropped.
const pendingOAuthStates = new Map();

// In-memory token store for iframe cross-origin authentication
export const tokenSessions = new Map();

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingOAuthStates.entries()) {
    if (now - val.createdAt > 15 * 60 * 1000) {
      pendingOAuthStates.delete(key);
    }
  }
  for (const [key, val] of tokenSessions.entries()) {
    if (now - val.createdAt > 12 * 60 * 60 * 1000) {
      tokenSessions.delete(key);
    }
  }
}, 60 * 1000).unref();

const unauthorized = (message) => {
  const err = new Error(message);
  err.status = 401;
  return err;
};

export const getUserToken = async (req) => {
  // Check Authorization Bearer header first (iframe support)
  const authHeader = req.headers?.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const sessionData = tokenSessions.get(token);
    if (sessionData?.tokens?.access_token) {
      const tokens = sessionData.tokens;
      if (Date.now() < tokens.expires_at - 60_000) {
        return tokens.access_token;
      }
      if (tokens.refresh_token) {
        try {
          const data = await postToken({
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            client_id: VITE_UIPATH_CLIENT_ID,
            client_secret: VITE_UIPATH_CLIENT_SECRET,
          });
          tokens.access_token = data.access_token;
          if (data.refresh_token) tokens.refresh_token = data.refresh_token;
          tokens.expires_at = Date.now() + (data.expires_in || 3600) * 1000;
          return tokens.access_token;
        } catch {
          tokenSessions.delete(token);
          throw unauthorized('Session expired');
        }
      }
    }
  }

  const tokens = req.session?.tokens;
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
  const codeVerifier = randomString();
  const nonce = randomString();
  const redirectUri = getRedirectUri(req);
  const now = Date.now();

  // Create cryptographic signed stateless state token
  const state = createOAuthState({
    codeVerifier,
    redirectUri,
    nonce,
    createdAt: now,
  });

  const oauthData = { state, codeVerifier, nonce, redirectUri, createdAt: now };

  // Store in server memory map as well for compatibility
  pendingOAuthStates.set(state, oauthData);

  if (req.session) {
    req.session.oauth = oauthData;
    await saveSession(req);
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: VITE_UIPATH_CLIENT_ID || '',
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
    nonce,
    code_challenge: challengeFor(codeVerifier),
    code_challenge_method: 'S256',
  });
  const fullAuthUrl = `${AUTHORIZE_URL}?${params.toString()}`;

  if (req.query.format === 'json' || req.headers.accept?.includes('application/json')) {
    return res.json({ url: fullAuthUrl, redirectUri });
  }

  res.redirect(fullAuthUrl);
});

const callbackHandler = async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) {
    console.error('❌ UiPath OAuth returned error:', error, error_description);
    return res.status(400).send(`Login failed: ${error_description || error}`);
  }

  // 1. Retrieve PKCE parameters: first try cryptographic stateless state
  let saved = unpackOAuthState(state);

  // 2. If not unpacked, check in-memory map
  if (!saved && state && pendingOAuthStates.has(state)) {
    saved = pendingOAuthStates.get(state);
    pendingOAuthStates.delete(state);
  }

  // 3. Fallback to session cookie
  if (!saved && req.session?.oauth) {
    saved = req.session.oauth;
  }

  if (!code || !state || !saved) {
    console.error(
      '❌ OAuth callback failed state verification. Query state:',
      state,
      'Has saved data:',
      !!saved
    );
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>UiPath Authentication - Session Expired</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; color: #1e293b; }
            .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 2.5rem 2rem; max-width: 440px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
            .icon { font-size: 2.5rem; margin-bottom: 1rem; }
            h2 { margin: 0 0 0.5rem; font-size: 1.25rem; color: #0f172a; }
            p { color: #64748b; font-size: 0.875rem; line-height: 1.5; margin: 0 0 1.5rem; }
            .btn { display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 600; font-size: 0.875rem; }
            .btn:hover { background: #1d4ed8; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">🔄</div>
            <h2>Session Expired or Server Restarted</h2>
            <p>Your previous sign-in attempt timed out or the server was restarted. Please click below to start a fresh sign-in.</p>
            <a href="/auth/login" class="btn">Sign In Again</a>
          </div>
        </body>
      </html>
    `);
  }

  try {
    const redirectUri = saved.redirectUri || getRedirectUri(req);
    const data = await postToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: VITE_UIPATH_CLIENT_ID,
      client_secret: VITE_UIPATH_CLIENT_SECRET,
      code_verifier: saved.codeVerifier,
    });

    const idClaims = data.id_token ? decodeJwt(data.id_token) : {};

    // Fetch additional user info from UserInfo endpoint using access token
    const userInfo = await getUserInfo(data.access_token);

    const user = {
      name:
        userInfo.first_name || userInfo.name || idClaims.name || 'User',
      email: userInfo.email || idClaims.email || null,
      sub: idClaims.sub || null,
    };

    // Generate bearer auth token for iframe compatibility
    const authToken = randomString();
    tokenSessions.set(authToken, {
      user,
      tokens: {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      },
      createdAt: Date.now(),
    });

    if (req.session) {
      await new Promise((resolve, reject) =>
        req.session.regenerate((err) => (err ? reject(err) : resolve()))
      );
      storeTokens(req, data);
      req.session.user = user;
      req.session.authToken = authToken;
      await saveSession(req);
    }

    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>UiPath Authentication</title></head>
        <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f4f5f8;">
          <script>
            const payload = {
              type: 'OAUTH_AUTH_SUCCESS',
              authToken: ${JSON.stringify(authToken)},
              user: ${JSON.stringify(user)}
            };
            try {
              localStorage.setItem('uipath_auth_token', ${JSON.stringify(authToken)});
            } catch (e) {}
            if (window.opener) {
              try {
                window.opener.postMessage(payload, '*');
              } catch (e) {}
              try {
                window.close();
              } catch (e) {}
            } else {
              window.location.href = '/';
            }
          </script>
          <div style="text-align: center;">
            <h2>Authentication Successful</h2>
            <p>You can close this window if it does not close automatically.</p>
            <p><a href="/" style="color: #4f46e5;">Return to app</a></p>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('❌ OAuth token exchange failed:', err.response?.data || err.message);
    res.status(500).send('Login failed during token exchange. Check the server logs.');
  }
};

authRouter.get('/callback', callbackHandler);
authRouter.get('/callback/', callbackHandler);

authRouter.post('/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    tokenSessions.delete(authHeader.slice(7).trim());
  }
  if (req.session) {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ ok: true });
    });
  } else {
    res.json({ ok: true });
  }
});

authRouter.get('/me', (req, res) => {
  const authHeader = req.headers?.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const sessionData = tokenSessions.get(token);
    if (sessionData?.user) {
      return res.json({ authenticated: true, user: sessionData.user, org, tenant });
    }
  }

  if (req.session?.tokens && req.session?.user) {
    return res.json({ authenticated: true, user: req.session.user, org, tenant });
  }
  res.json({ authenticated: false });
});
