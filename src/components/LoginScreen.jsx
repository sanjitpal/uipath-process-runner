// The unauthenticated landing screen. The button is a full-page navigation to
// the backend's /auth/login (NOT an XHR) — the backend 302-redirects the whole
// browser to UiPath's login, which an XHR could not follow (CORS).
function LoginScreen() {
  const login = () => window.location.assign('/auth/login');

  return (
    <div className="login-shell">
      <div className="login-card">
        <span className="brand-mark login-mark">◆</span>
        <h1>UiPath Process Runner</h1>
        <p className="login-sub">
          Sign in with your UiPath account to run and monitor the processes in
          your own Orchestrator folders.
        </p>
        <button className="btn btn-primary btn-login" onClick={login}>
          Login with UiPath
        </button>
        <p className="login-note">
          You'll be redirected to UiPath to authenticate, then brought back here.
        </p>
      </div>
    </div>
  );
}

export default LoginScreen;
