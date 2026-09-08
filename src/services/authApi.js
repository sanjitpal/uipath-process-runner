import axios from 'axios';

const api = axios.create({ baseURL: '', withCredentials: true });

// Attach Authorization header if stored
api.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem('uipath_auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {}
  return config;
});

// Who is logged in? Returns { authenticated, user, org, tenant }.
export const getMe = async () => {
  const { data } = await api.get('/auth/me');
  return data;
};

// Destroy the server-side session. The caller navigates afterwards.
export const logout = async () => {
  try {
    const { data } = await api.post('/auth/logout');
    try {
      localStorage.removeItem('uipath_auth_token');
    } catch {}
    return data;
  } catch (err) {
    try {
      localStorage.removeItem('uipath_auth_token');
    } catch {}
    throw err;
  }
};