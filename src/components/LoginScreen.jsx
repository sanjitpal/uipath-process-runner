import { useState } from 'react';

// The unauthenticated landing screen. Supports UiPath authentication.
function LoginScreen() {
  const [loggingIn, setLoggingIn] = useState(false);

  const handleLogin = async () => {
    setLoggingIn(true);
    try {
      const res = await fetch('/auth/login?format=json', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          const authWindow = window.open(
            data.url,
            'uipath_oauth_popup',
            'width=600,height=720,menubar=no,toolbar=no'
          );
          if (authWindow) {
            setLoggingIn(false);
            return;
          }
        }
      }
    } catch (err) {
      console.warn('Popup login initiation failed, falling back to direct navigation:', err);
    }
    // Fallback if popup blocked
    window.location.assign('/auth/login');
  };

  return (
    <div className="login-shell">
      <div className="login-card" style={{ maxWidth: '460px' }}>
        <span className="brand-mark login-mark">🏢</span>
        <h1>Tuwaiq Call Center CRM</h1>
        <p className="login-sub">
          Sign in to access the Call Record Form integrated with UiPath Unattended Automation for customer services.
        </p>

        <div style={{ width: '100%', marginTop: '1.5rem' }}>
          <button
            className="btn btn-primary btn-login"
            onClick={handleLogin}
            disabled={loggingIn}
            style={{ width: '100%', justifyContent: 'center', padding: '0.875rem 1.25rem' }}
          >
            {loggingIn ? 'Connecting to UiPath…' : 'Login with UiPath'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default LoginScreen;
