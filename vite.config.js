import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['tests/unit/**/*.test.js'],
  },
});
