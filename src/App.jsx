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
import FullNameForm from './components/FullNameForm';
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

// OutputArguments comes back as a JSON string; turn it into [key, value] pairs.
const parseArgs = (raw) => {
  if (!raw) return [];
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Object.entries(obj || {});
  } catch {
    return [];
  }
};

const renderValue = (value) =>
  value !== null && typeof value === 'object'
    ? JSON.stringify(value, null, 2)
    : String(value);

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
  const args = parseArgs(job.OutputArguments);
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

      <div className="output-block">
        <div className="output-title">Output</div>
        {args.length === 0 ? (
          <div className="output-empty">No output arguments returned.</div>
        ) : (
          <dl className="output-list">
            {args.map(([key, value]) => (
              <div className="output-row" key={key}>
                <dt>{key}</dt>
                <dd>{renderValue(value)}</dd>
              </div>
            ))}
          </dl>
        )}
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

  // Check the session once on load.
  useEffect(() => {
    (async () => {
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
    })();
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
          'Could not reach the backend server on port 3001.'
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
          <span className="brand-mark">◆</span>
          <div>
            <h1>UiPath Process Runner</h1>
            <p>{org ? `Orchestrator · ${org}` : 'Trigger and monitor your automations'}</p>
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

      <div className="sub-status">
        <div className={`status-pill ${jobsError ? 'is-down' : 'is-live'}`}>
          <span className="status-dot" />
          {jobsError ? 'Disconnected' : `Live · updated ${fmtTime(lastUpdated)}`}
        </div>
      </div>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
      {foldersError && <div className="banner banner-error">{foldersError}</div>}
      {jobsError && <div className="banner banner-error">{jobsError}</div>}

      {/* Section 1 --------------------------------------------------------- */}
      <section className="panel">
        <div className="panel-head">
          <h2>
            <span className="idx">1</span> Available Processes
          </h2>
          <div className="panel-actions">
            <span className="count">{processes.length}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={loadProcesses}
              disabled={loadingProcesses}
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {processesError ? (
          <div className="banner banner-error">{processesError}</div>
        ) : loadingProcesses ? (
          <div className="muted">Loading processes…</div>
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
                  <div className="process-meta">v{proc.ProcessVersion}</div>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => handleRun(proc)}
                  disabled={startingKey === proc.Key}
                >
                  {startingKey === proc.Key ? 'Starting…' : '▶ Run'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section 2 --------------------------------------------------------- */}
      <section className="panel">
        <div className="panel-head">
          <h2>
            <span className="idx">2</span> Running &amp; Pending
          </h2>
          <span className="count">{activeJobs.length}</span>
        </div>

        {activeJobs.length === 0 ? (
          <div className="empty">Nothing running right now.</div>
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

      {/* Section 3 --------------------------------------------------------- */}
      <section className="panel">
        <div className="panel-head">
          <h2>
            <span className="idx">3</span> Completed Today · Output
          </h2>
          <span className="count">{completedJobs.length}</span>
        </div>

        {completedJobs.length === 0 ? (
          <div className="empty">No successful runs yet today.</div>
        ) : (
          <div className="job-grid">
            {completedJobs.map((job) => (
              <OutputCard key={job.Id} job={job} />
            ))}
          </div>
        )}
      </section>

      
      {/* Section 4: FullName Form ------------------------------------------- */}
      <section className="panel">
        <FullNameForm
          releaseKey={selectedProcessKey}
          folderId={selectedFolderId}
        />

        <div className="form-process-selector">
          <label htmlFor="processSelect">Select Process (Release Key):</label>
          <select
            id="processSelect"
            value={selectedProcessKey}
            onChange={(e) => setSelectedProcessKey(e.target.value)}
            disabled={processes.length === 0}
          >
            <option value="">-- Select a process --</option>
            {processes.map((proc) => (
              <option key={proc.Key} value={proc.Key}>
                {proc.Name} ({proc.Key})
              </option>
            ))}
          </select>
          {processes.length === 0 && (
            <p className="muted">No processes available. Select a folder with processes.</p>
          )}
        </div>
      </section>

      <footer className="app-footer">
        Auto-refreshing every {POLL_INTERVAL / 1000}s · backend proxy on port 3001
      </footer>
    </div>
  );
}

export default App;
