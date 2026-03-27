import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:8420',
        ws: true,
      },
      '/healthz': 'http://127.0.0.1:8420',
      '/auth': 'http://127.0.0.1:8420',
    },
  },
});
