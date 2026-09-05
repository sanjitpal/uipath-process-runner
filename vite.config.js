import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// The /api and /auth paths are proxied to the Express backend so the browser
// only ever talks to localhost:5173. That keeps the session cookie and the
// OAuth redirect same-origin (no cross-site cookie / CORS headaches).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/auth': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
