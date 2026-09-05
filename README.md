<<<<<<< HEAD
# UiPath Process Runner (React + Express)

A small React app where each user **logs in with their own UiPath account** and
then runs and monitors the Orchestrator processes in their own folders. The
browser can't call the Orchestrator API directly (CORS) and must not hold OAuth
tokens, so a small Express backend does the OAuth handshake, keeps the tokens in
a server-side session, and proxies requests to Orchestrator.

## Sections

1. **Available Processes** — every process (Release) in the selected folder,
   each with a **Run** button.
2. **Running & Pending** — jobs currently `Running`/`Pending`, with a live
   duration and a **Stop** action. Polls every 5 seconds.
3. **Completed Today · Output** — today's `Successful` (and `Stopped`) jobs and
   their output arguments.

A **folder picker** in the header scopes all three sections; it defaults to the
first folder the logged-in user can access.

## How login works

- Click **Login with UiPath** → the backend redirects the browser to UiPath
  (OAuth **Authorization Code** + PKCE).
- After you authenticate, UiPath redirects back to `/auth/callback`; the backend
  exchanges the code for tokens and stores them in a **server-side session**
  (HttpOnly cookie). Tokens never reach the browser.
- All Orchestrator calls then run **as the logged-in user**, so you only see the
  folders, processes, and jobs your UiPath permissions allow.

> **Who can log in:** anyone who is a **member of the organization** where the
> External Application is registered (`sanjintoppzh`). UiPath rejects the login
> for users outside that org.

## Prerequisite — configure the UiPath External Application (one-time, manual)

In **UiPath Admin → External Applications**, edit your *confidential*
application and:

1. **Add a Redirect URL:** `http://localhost:5173/auth/callback`
2. Under **User (delegate) Scope(s)**, enable:
   - `OR.Execution` — list processes (Releases)
   - `OR.Jobs` — start / read / stop jobs
   - `OR.Folders` — list folders
   (`openid`, `profile`, `offline_access` are standard OpenID scopes.)

Without both the redirect URL and the scopes, login fails. This step can't be
automated.

## Configuration (`.env`)

```
VITE_UIPATH_TENANT_URL=https://cloud.uipath.com/<org>/<tenant>/orchestrator_
VITE_UIPATH_CLIENT_ID=...
VITE_UIPATH_CLIENT_SECRET=...
UIPATH_OAUTH_AUTHORIZE_URL=https://cloud.uipath.com/<org>/identity_/connect/authorize
UIPATH_OAUTH_TOKEN_URL=https://cloud.uipath.com/<org>/identity_/connect/token
UIPATH_OAUTH_REDIRECT_URI=http://localhost:5173/auth/callback
VITE_UIPATH_SCOPE=openid profile offline_access OR.Execution OR.Jobs OR.Folders
SESSION_SECRET=<random string>
VITE_UIPATH_ORG_UNIT_ID=<folder id>   # dev-only fallback; real users default to their first folder
```

The client secret and session tokens are only ever read by the backend
(`server.js` / `auth.js`) and are never sent to the browser.

## Run it

Install dependencies once:

```bash
npm install
```

Start the backend proxy (terminal 1):

```bash
npm run server
```

Start the React dev server (terminal 2):

```bash
npm run dev
```

Open http://localhost:5173 and click **Login with UiPath**. The Vite dev server
proxies `/api` and `/auth` to the backend on http://localhost:3001, so the app
stays same-origin (needed for the session cookie and OAuth redirect).
=======
# uipath-process-runner
>>>>>>> d5b35ed256fb607d301b7ef04c0a500f302b9b1c
