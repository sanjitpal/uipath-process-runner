import { useState, useEffect, useCallback } from 'react';
import {
  getFolders,
  getProcesses,
  startUiPathJob,
  getActiveJobs,
  getCompletedJobsToday,
  stopJob,
} from './services/uiPathApi';
import { getMe, logout } from './services/authApi';
import LoginScreen from './components/LoginScreen';
import TuwaiqCallRecordForm from './components/TuwaiqCallRecordForm';
import './App.css';


const POLL_INTERVAL = 5000;

// --- helpers ---------------------------------------------------------------
const fmtTime = (value) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—';

const durationStr = (start, end) => {
  if (!start) return '—';
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : Date.now();
  let secs = Math.max(0, Math.floor((to - from) / 1000));
  const h = Math.floor(secs / 3600);
  secs %= 3600;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
};

// --- section 2 card --------------------------------------------------------
function ActiveJobCard({ job, onStop, stopping }) {
  const isPending = job.State === 'Pending';
  return (
    <div className={`job-card ${isPending ? 'is-pending' : 'is-running'}`}>
      <div className="job-top">
        <span className={`badge ${isPending ? 'badge-pending' : 'badge-running'}`}>
          <span className="pulse" />
          {job.State}
        </span>
        <span className="job-id">#{job.Id}</span>
      </div>

      <div className="job-name">{job.ReleaseName || 'Unknown process'}</div>

      <div className="job-facts">
        <div>
          <span className="k">{job.StartTime ? 'Started' : 'Queued'}</span>
          <span className="v">{fmtTime(job.StartTime || job.CreationTime)}</span>
        </div>
        <div>
          <span className="k">Duration</span>
          <span className="v">
            {job.StartTime ? durationStr(job.StartTime) : 'waiting…'}
          </span>
        </div>
        <div>
          <span className="k">Machine</span>
          <span className="v">{job.HostMachineName || '—'}</span>
        </div>
      </div>

      <button
        className="btn btn-danger btn-sm"
        onClick={() => onStop(job)}
        disabled={stopping}
      >
        {stopping ? 'Stopping…' : 'Stop'}
      </button>
    </div>
  );
}

// --- section 3 card --------------------------------------------------------
function OutputCard({ job }) {
  const isStopped = job.State === 'Stopped';
  const cardClass = isStopped ? 'job-card is-stopped' : 'job-card is-success';
  const badgeClass = isStopped ? 'badge badge-secondary' : 'badge badge-success';
  return (
    <div className={cardClass}>
      <div className="job-top">
        <span className={badgeClass}>{job.State}</span>
        <span className="job-id">#{job.Id}</span>
      </div>

      <div className="job-name">{job.ReleaseName || 'Unknown process'}</div>

      <div className="job-facts">
        <div>
          <span className="k">Finished</span>
          <span className="v">{fmtTime(job.EndTime)}</span>
        </div>
        <div>
          <span className="k">Duration</span>
          <span className="v">{durationStr(job.StartTime, job.EndTime)}</span>
        </div>
      </div>
    </div>
  );
}

// --- app -------------------------------------------------------------------
function App() {
  // auth: 'loading' → checking session; 'anon' → show login; 'authed' → app
  const [authStatus, setAuthStatus] = useState('loading');
  const [user, setUser] = useState(null);
  const [org, setOrg] = useState(null);

  const [folders, setFolders] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [foldersError, setFoldersError] = useState(null);

  const [processes, setProcesses] = useState([]);
  const [loadingProcesses, setLoadingProcesses] = useState(true);
  const [processesError, setProcessesError] = useState(null);
  const [startingKey, setStartingKey] = useState(null);

    // FullName form state
  const [selectedProcessKey, setSelectedProcessKey] = useState('');
  const [activeTab, setActiveTab] = useState('form'); // 'form' | 'dashboard' | 'both'

  const [activeJobs, setActiveJobs] = useState([]);
  const [completedJobs, setCompletedJobs] = useState([]);
  const [jobsError, setJobsError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [stoppingId, setStoppingId] = useState(null);

  const [toast, setToast] = useState(null);
  const showToast = (type, text) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4000);
  };

  // If any call comes back 401, the session is gone — drop back to login.
  const handleAuthError = useCallback((err) => {
    if (err.response?.status === 401) {
      setAuthStatus('anon');
      setUser(null);
      return true;
    }
    return false;
  }, []);

  // Check the session once on load, and listen for popup OAuth message.
  useEffect(() => {
    const checkSession = async () => {
      try {
        const me = await getMe();
        if (me.authenticated) {
          setUser(me.user);
          setOrg(me.org);
          setAuthStatus('authed');
        } else {
          setAuthStatus('anon');
        }
      } catch {
        setAuthStatus('anon');
      }
    };

    checkSession();

    const handleMessage = (event) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        if (event.data.authToken) {
          try {
            localStorage.setItem('uipath_auth_token', event.data.authToken);
          } catch {}
        }
        checkSession();
      }
    };

    const handleStorage = (event) => {
      if (event.key === 'uipath_auth_token' && event.newValue) {
        checkSession();
      }
    };

    const handleFocus = () => {
      checkSession();
    };

    window.addEventListener('message', handleMessage);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Once authenticated, load the user's folders and default to the first one.
  useEffect(() => {
    if (authStatus !== 'authed') return;
    (async () => {
      try {
        const data = await getFolders();
        const list = data.value || [];
        setFolders(list);
        setFoldersError(null);
        if (list.length > 0) setSelectedFolderId(String(list[0].Id));
      } catch (err) {
        if (handleAuthError(err)) return;
        setFoldersError(
          err.response?.data?.error || 'Could not load your folders.'
        );
      }
    })();
  }, [authStatus, handleAuthError]);

  const loadProcesses = useCallback(async () => {
    if (!selectedFolderId) return;
    setLoadingProcesses(true);
    setProcessesError(null);
    try {
      const data = await getProcesses(selectedFolderId);
      setProcesses(data.value || []);
    } catch (err) {
      if (handleAuthError(err)) return;
      setProcessesError(
        err.response?.data?.error ||
          'Could not load processes. Is the backend server running?'
      );
    } finally {
      setLoadingProcesses(false);
    }
  }, [selectedFolderId, handleAuthError]);

  const loadJobs = useCallback(async () => {
    if (!selectedFolderId) return;
    try {
      const [active, completed] = await Promise.all([
        getActiveJobs(selectedFolderId),
        getCompletedJobsToday(selectedFolderId),
      ]);
      setActiveJobs(active.value || []);
      setCompletedJobs(completed.value || []);
      setJobsError(null);
      setLastUpdated(new Date());
    } catch (err) {
      if (handleAuthError(err)) return;
      setJobsError(
        err.response?.data?.error ||
          'Could not reach the backend server.'
      );
    }
  }, [selectedFolderId, handleAuthError]);

  // Load processes when the selected folder changes.
  useEffect(() => {
    if (authStatus === 'authed' && selectedFolderId) loadProcesses();
  }, [authStatus, selectedFolderId, loadProcesses]);

  // Poll jobs for the selected folder.
  useEffect(() => {
    if (authStatus !== 'authed' || !selectedFolderId) return;
    loadJobs();
    const id = setInterval(loadJobs, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [authStatus, selectedFolderId, loadJobs]);

  // Re-render once a second so running durations tick up live.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const handleRun = async (proc) => {
    setStartingKey(proc.Key);
    try {
      await startUiPathJob(proc.Key, selectedFolderId);
      showToast('success', `Started “${proc.Name}”`);
      await loadJobs();
    } catch (err) {
      if (handleAuthError(err)) return;
      showToast('error', err.response?.data?.error || `Failed to start “${proc.Name}”`);
    } finally {
      setStartingKey(null);
    }
  };

  const handleStop = async (job) => {
    setStoppingId(job.Id);
    try {
      await stopJob(job.Id, selectedFolderId);
      showToast('success', `Stopping job #${job.Id}`);
      await loadJobs();
    } catch (err) {
      if (handleAuthError(err)) return;
      showToast('error', err.response?.data?.error || 'Failed to stop job');
    } finally {
      setStoppingId(null);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      /* clear local state regardless */
    }
    setUser(null);
    setFolders([]);
    setSelectedFolderId(null);
    setProcesses([]);
    setActiveJobs([]);
    setCompletedJobs([]);
    setAuthStatus('anon');
  };

  // --- render ---------------------------------------------------------------
  if (authStatus === 'loading') {
    return <div className="app-boot">Checking your UiPath session…</div>;
  }
  if (authStatus === 'anon') {
    return <LoginScreen />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">🏢</span>
          <div>
            <h1>Tuwaiq Call Center CRM</h1>
            <p>{org ? `UiPath Unattended Integration · ${org}` : 'Call Record Management & Automation'}</p>
          </div>
        </div>

        <div className="header-right">
          <label className="folder-picker">
            <span className="folder-label">Folder</span>
            <select
              value={selectedFolderId || ''}
              onChange={(e) => setSelectedFolderId(e.target.value)}
              disabled={folders.length === 0}
            >
              {folders.length === 0 ? (
                <option value="">No folders</option>
              ) : (
                folders.map((f) => (
                  <option key={f.Id} value={f.Id}>
                    {f.FullyQualifiedName || f.DisplayName}
                  </option>
                ))
              )}
            </select>
          </label>

          <div className="user-chip" title={user?.email || user?.name}>
            <span className="user-avatar">
              {(user?.name || '?').charAt(0).toUpperCase()}
            </span>
            <span className="user-name">{user?.name}</span>
          </div>

          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      {/* View Switcher Tabs & Live Status Bar */}
      <div className="view-nav-wrapper">
        <div className="view-tabs">
          <button
            type="button"
            className={`view-tab-btn ${activeTab === 'form' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('form')}
          >
            <span>📋</span>
            <span>Call Record Form</span>
          </button>

          <button
            type="button"
            className={`view-tab-btn ${activeTab === 'dashboard' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <span>📊</span>
            <span>Orchestrator Dashboard</span>
            {activeJobs.length > 0 ? (
              <span className="tab-badge badge-active">
                <span className="tab-badge-pulse" /> {activeJobs.length} running
              </span>
            ) : completedJobs.length > 0 ? (
              <span className="tab-badge">
                {completedJobs.length} done
              </span>
            ) : null}
          </button>
        </div>

        <div className="sub-status" style={{ margin: 0 }}>
          <div className={`status-pill ${jobsError ? 'is-down' : 'is-live'}`}>
            <span className="status-dot" />
            {jobsError ? 'Disconnected' : `Live · updated ${fmtTime(lastUpdated)}`}
          </div>
        </div>
      </div>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
      {foldersError && <div className="banner banner-error">{foldersError}</div>}
      {jobsError && <div className="banner banner-error">{jobsError}</div>}

      {/* Main Form: Tuwaiq Call Record Form */}
      {activeTab === 'form' && (
        <TuwaiqCallRecordForm
          selectedProcessKey={selectedProcessKey}
          onSelectProcessKey={setSelectedProcessKey}
          processes={processes}
          loadingProcesses={loadingProcesses}
          processesError={processesError}
          onRefreshProcesses={loadProcesses}
          folderId={selectedFolderId}
          onJobUpdate={loadJobs}
          onViewDashboard={() => setActiveTab('dashboard')}
        />
      )}

      {/* Orchestrator Dashboard: Available Processes, Running Jobs & Completed Outputs */}
      {activeTab === 'dashboard' && (
        <div className="orchestrator-dashboard-view" style={{ marginTop: '0.5rem' }}>
          {/* Quick Metrics KPI Bar */}
          <div className="dashboard-summary-bar">
            <div className="summary-card">
              <div>
                <div className="summary-card-val">{processes.length}</div>
                <div className="summary-card-lbl">Available Processes in Folder</div>
              </div>
              <span style={{ fontSize: '24px' }}>⚡</span>
            </div>
            <div className="summary-card">
              <div>
                <div className="summary-card-val" style={{ color: activeJobs.length > 0 ? 'var(--primary)' : 'inherit' }}>
                  {activeJobs.length}
                </div>
                <div className="summary-card-lbl">Running &amp; Pending Jobs</div>
              </div>
              <span style={{ fontSize: '24px' }}>🤖</span>
            </div>
            <div className="summary-card">
              <div>
                <div className="summary-card-val" style={{ color: completedJobs.length > 0 ? 'var(--success)' : 'inherit' }}>
                  {completedJobs.length}
                </div>
                <div className="summary-card-lbl">Completed Today</div>
              </div>
              <span style={{ fontSize: '24px' }}>✓</span>
            </div>
          </div>

          {/* Section 1: Available Processes in Folder */}
          <section className="panel">
            <div className="panel-head">
              <h2>
                <span className="idx">1</span> Available Processes in Folder
              </h2>
              <div className="panel-actions">
                <span className="count">{processes.length}</span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={loadProcesses}
                  disabled={loadingProcesses}
                  title="Reload processes from Orchestrator"
                >
                  ↻ Refresh
                </button>
              </div>
            </div>

            {processesError ? (
              <div className="banner banner-error">{processesError}</div>
            ) : loadingProcesses ? (
              <div className="muted">Loading processes from folder…</div>
            ) : processes.length === 0 ? (
              <div className="empty">No processes are assigned to this folder.</div>
            ) : (
              <div className="process-grid">
                {processes.map((proc) => (
                  <div className="process-card" key={proc.Key}>
                    <div className="process-body">
                      <div className="process-name">{proc.Name}</div>
                      {proc.Description && (
                        <div className="process-desc">{proc.Description}</div>
                      )}
                      <div className="process-meta">v{proc.ProcessVersion || '1.0'}</div>
                    </div>
                    <div className="process-card-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleRun(proc)}
                        disabled={startingKey === proc.Key}
                        title="Start unattended job directly in Orchestrator"
                      >
                        {startingKey === proc.Key ? 'Starting…' : '▶ Run'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Section 2: Running & Pending Unattended Jobs */}
          <section className="panel">
            <div className="panel-head">
              <h2>
                <span className="idx">2</span> Running &amp; Pending Jobs
              </h2>
              <span className="count">{activeJobs.length}</span>
            </div>

            {activeJobs.length === 0 ? (
              <div className="empty">Nothing running right now in this folder.</div>
            ) : (
              <div className="job-grid">
                {activeJobs.map((job) => (
                  <ActiveJobCard
                    key={job.Id}
                    job={job}
                    onStop={handleStop}
                    stopping={stoppingId === job.Id}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Section 3: Completed Today */}
          <section className="panel">
            <div className="panel-head">
              <h2>
                <span className="idx">3</span> Completed Today
              </h2>
              <span className="count">{completedJobs.length}</span>
            </div>

            {completedJobs.length === 0 ? (
              <div className="empty">No successful unattended runs yet today.</div>
            ) : (
              <div className="job-grid">
                {completedJobs.map((job) => (
                  <OutputCard key={job.Id} job={job} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <footer className="app-footer">
        Tuwaiq Call Center CRM · Orchestrator auto-refreshing every {POLL_INTERVAL / 1000}s
      </footer>
    </div>
  );
}

export default App;
