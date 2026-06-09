import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174, // 5173 is reserved for another local process — keep AncoraLens v2 off it
    strictPort: true, // fail loudly instead of drifting to another port (keeps preview registry in sync)
    // In dev, the frontend (5174) proxies /api to the Express server (3001).
    // In production the unified server serves both on one port, so the app
    // calls /api on the same origin (see VITE_API_BASE_URL default of "").
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
