import axios from 'axios';

// Same-origin: Vite proxies /api to the backend. withCredentials sends the
// session cookie so the backend can act as the logged-in user.
const api = axios.create({ baseURL: '', withCredentials: true });

// folderId scopes every Orchestrator call to the folder the user picked. Sent
// as a query param on all requests (incl. POSTs) so the backend can read it
// uniformly from req.query.
const withFolder = (folderId) => ({ params: folderId ? { folderId } : {} });

// Folders the logged-in user can access (populates the folder picker).
export const getFolders = async () => {
  const { data } = await api.get('/api/uipath/folders');
  return data;
};

// Section 1: processes available in the selected folder.
export const getProcesses = async (folderId) => {
  const { data } = await api.get('/api/uipath/processes', withFolder(folderId));
  return data;
};

// Start a job for a given process (Release GUID key) in the selected folder.
export const startUiPathJob = async (releaseKey, folderId) => {
  const { data } = await api.post('/api/uipath/start-job', { releaseKey }, withFolder(folderId));
  return data;
};

// Section 2: running + pending jobs in the selected folder.
export const getActiveJobs = async (folderId) => {
  const { data } = await api.get('/api/uipath/jobs/active', withFolder(folderId));
  return data;
};

// Section 3: today's finished jobs (with output arguments) in the selected folder.
export const getCompletedJobsToday = async (folderId) => {
  const { data } = await api.get('/api/uipath/jobs/completed-today', withFolder(folderId));
  return data;
};

// Stop a running/pending job in the selected folder.
export const stopJob = async (jobId, folderId) => {
  const { data } = await api.post(`/api/uipath/stop-job/${jobId}`, null, withFolder(folderId));
  return data;
};
