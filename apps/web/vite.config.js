import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Load every variable from apps/web/.env* (not only VITE_*): these are dev-server settings,
  // they are never exposed to the browser bundle.
  const env = { ...loadEnv(mode, import.meta.dirname, ''), ...process.env };
  const apiPort = Number(env.API_PORT ?? 4000);
  const webPort = Number(env.WEB_PORT ?? 5173);

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: webPort,
      strictPort: true,
      proxy: {
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
      },
    },
    test: {
      name: 'web',
      environment: 'jsdom',
      include: ['src/**/*.test.{js,jsx}', 'test/**/*.test.{js,jsx}'],
      setupFiles: ['./test/setup.js'],
    },
  };
});
