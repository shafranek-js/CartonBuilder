import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  publicDir: 'vendor',
  server: {
    host: '127.0.0.1',
    watch: {
      ignored: ['**/dist-*/**', '**/graphify-out/**'],
    },
  },
  build: {
    target: 'es2022',
  },
  optimizeDeps: {
    entries: ['index.html'],
    esbuildOptions: {
      target: 'es2022',
    },
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['tests/unit/**/*.test.js'],
  },
});
