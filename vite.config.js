import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
  },
  test: {
    include: ['tests/unit/**/*.test.js'],
  },
});
