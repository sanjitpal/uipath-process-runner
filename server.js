// Load .env FIRST (side-effect import) so it's populated before auth.js — which
// reads process.env at module load — is evaluated. ESM hoists imports, so a
// plain `dotenv.config()` call below would run too late.
import 'dotenv/config';
import express from 'express';
import axios from 'axios';

import {
  sessionMiddleware,
  authRouter,
  requireAuth,
  authConfig,
} from './auth.js';

const app = express();
const PORT = process.env.PORT || 3001;

const { VITE_UIPATH_TENANT_URL, VITE_UIPATH_ORG_UNIT_ID } = process.env;

// No cors() middleware: the browser reaches this server same-origin through the
// Vite proxy, and Access-Control-Allow-Origin:* is invalid once cookies are in
// play. Session must be mounted before the routes that read it.
app.use(sessionMiddleware);
app.use(express.json());
app.use('/auth', authRouter);

// Thin wrapper attaching the logged-in user's token + the folder header to
// every Orchestrator call. Pass folderId:null to omit the folder header
// entirely (used for the tenant-scoped /odata/Folders listing).
const orchestrator = async (req, config) => {
  const { folderId, headers, ...rest } = config;
  const folder =
    folderId === null
      ? null
      : folderId ?? req.query.folderId ?? VITE_UIPATH_ORG_UNIT_ID;
  return axios({
    ...rest,
    headers: {
      Authorization: `Bearer ${req.accessToken}`,
      'Content-Type': 'application/json',
      ...(folder ? { 'X-UIPATH-OrganizationUnitId': folder } : {}),
      ...(headers || {}),
    },
  });
};

const sendError = (res, error, message) => {
  const detail = error.response?.data;
  console.error(`❌ ${message}:`, detail || error.message);
  res.status(error.response?.status || 500).json({
    error:
      detail?.message ||
      detail?.error_description ||
      detail?.error ||
      error.message ||
      message,
  });
};

// --- Folders the logged-in user can access (drives the folder picker) ------
app.get('/api/uipath/folders', requireAuth, async (req, res) => {
  try {
    const select = '$select=Id,DisplayName,FullyQualifiedName';
    const url = `${VITE_UIPATH_TENANT_URL}/odata/Folders?${select}&$top=200`;
    const { data } = await orchestrator(req, { method: 'get', url, folderId: null });
    res.json(data);
  } catch (error) {
    sendError(res, error, 'Failed to fetch folders');
  }
});

// --- Section 1: processes the user can run in the selected folder ----------
app.get('/api/uipath/processes', requireAuth, async (req, res) => {
  try {
    const select = '$select=Id,Key,Name,ProcessKey,ProcessVersion,Description';
    const url = `${VITE_UIPATH_TENANT_URL}/odata/Releases?${select}&$orderby=Name asc`;
    const { data } = await orchestrator(req, { method: 'get', url });
    res.json(data);
  } catch (error) {
    sendError(res, error, 'Failed to fetch processes');
  }
});

// --- Start a job for a given process (Release) -----------------------------
app.post('/api/uipath/start-job', requireAuth, async (req, res) => {
  try {
    const { releaseKey } = req.body;
    if (!releaseKey) {
      return res.status(400).json({ error: 'releaseKey is required' });
    }

    const url = `${VITE_UIPATH_TENANT_URL}/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs`;
    const { data } = await orchestrator(req, {
      method: 'post',
      url,
      data: {
        startInfo: {
          ReleaseKey: releaseKey,
          Strategy: 'ModernJobsCount',
          JobsCount: 1,
          RuntimeType: 'Unattended',
        },
      },
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, 'Failed to start job');
  }
});

// --- Section 2: currently running + pending jobs ---------------------------
app.get('/api/uipath/jobs/active', requireAuth, async (req, res) => {
  try {
    const filter = encodeURIComponent(
      "State eq 'Running' or State eq 'Pending' or State eq 'Resumed'"
    );
    const url = `${VITE_UIPATH_TENANT_URL}/odata/Jobs?$filter=${filter}&$orderby=CreationTime desc&$top=100`;
    const { data } = await orchestrator(req, { method: 'get', url });
    res.json(data);
  } catch (error) {
    sendError(res, error, 'Failed to fetch active jobs');
  }
});

// --- Section 3: today's finished jobs (with their output arguments) --------
app.get('/api/uipath/jobs/completed-today', requireAuth, async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const filter = encodeURIComponent(
      `(State eq 'Successful' or State eq 'Stopped') and CreationTime ge ${startOfToday.toISOString()}`
    );
    const url = `${VITE_UIPATH_TENANT_URL}/odata/Jobs?$filter=${filter}&$orderby=EndTime desc&$top=100`;
    const { data } = await orchestrator(req, { method: 'get', url });
    res.json(data);
  } catch (error) {
    sendError(res, error, 'Failed to fetch completed jobs');
  }
});

// --- Stop a running/pending job --------------------------------------------
app.post('/api/uipath/stop-job/:jobId', requireAuth, async (req, res) => {
  try {
    const { jobId } = req.params;
    const url = `${VITE_UIPATH_TENANT_URL}/odata/Jobs(${jobId})/UiPath.Server.Configuration.OData.StopJob`;
    await orchestrator(req, { method: 'post', url, data: { strategy: 'Kill' } });
    res.json({ success: true, message: 'Job stopped successfully' });
  } catch (error) {
    sendError(res, error, 'Failed to stop job');
  }
});

// --- Start a job with input arguments --------------------------------------
app.post('/api/uipath/start-job-with-args', requireAuth, async (req, res) => {
  try {
    const { releaseKey, inputArgs } = req.body;
    if (!releaseKey) {
      return res.status(400).json({ error: 'releaseKey is required' });
    }

    const url = `${VITE_UIPATH_TENANT_URL}/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs`;
    const { data } = await orchestrator(req, {
      method: 'post',
      url,
      data: {
        startInfo: {
          ReleaseKey: releaseKey,
          Strategy: 'ModernJobsCount',
          JobsCount: 1,
          RuntimeType: 'Unattended',
          InputArguments: inputArgs ? JSON.stringify(inputArgs) : null,
        },
      },
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, 'Failed to start job with arguments');
  }
});

// --- Get a specific job by ID (for polling) --------------------------------
app.get('/api/uipath/jobs/:jobId', requireAuth, async (req, res) => {
  try {
    const { jobId } = req.params;
    const url = `${VITE_UIPATH_TENANT_URL}/odata/Jobs(${jobId})?$select=Id,State,StartTime,EndTime,OutputArguments`;
    const { data } = await orchestrator(req, { method: 'get', url });
    res.json(data);
  } catch (error) {
    sendError(res, error, 'Failed to fetch job');
  }
});

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, org: authConfig.org, tenant: authConfig.tenant, scope: authConfig.SCOPE })
);

app.listen(PORT, () => {
  console.log(`🚀 Backend proxy server running on http://localhost:${PORT}`);
  console.log(`   Org: ${authConfig.org}  Tenant: ${authConfig.tenant}`);
  console.log(`   Authorize: ${authConfig.AUTHORIZE_URL}`);
});