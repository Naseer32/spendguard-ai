import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Dev only. Leave "Backend address" empty in Settings and the dev server forwards /api to
  // this target, so no CORS setup is needed. Default: the backend's default port.
  const target = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      // Listen on all interfaces so an Android phone on the same network can
      // open the dev server for real-device testing.
      host: true,
      proxy: { '/api': { target, changeOrigin: false } },
    },
  };
});
