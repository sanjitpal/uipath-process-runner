import axios from 'axios';

const api = axios.create({ baseURL: '', withCredentials: true });

// Who is logged in? Returns { authenticated, user, org, tenant }.
export const getMe = async () => {
  const { data } = await api.get('/auth/me');
  return data;
};

// Destroy the server-side session. The caller navigates afterwards.
export const logout = async () => {
  const { data } = await api.post('/auth/logout');
  return data;
};