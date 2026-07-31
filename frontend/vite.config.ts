import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The SWA CLI proxies /api/* to the Functions runtime locally, and the
// deployed SWA does the same in production. Vite forwards /api/* and
// /.auth/* through rather than treating them as frontend routes.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:7071',
      '/.auth': 'http://localhost:4280'
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
