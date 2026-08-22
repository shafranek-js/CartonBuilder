import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const bundledExamplePath = resolve('public/Calmdownol_template.carton');

function serveBundledExample() {
  return {
    name: 'serve-bundled-example',
    configureServer(server) {
      server.middlewares.use('/Calmdownol_template.carton', (request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          next();
          return;
        }
        const bytes = readFileSync(bundledExamplePath);
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/octet-stream');
        response.setHeader('Content-Length', bytes.byteLength);
        if (request.method === 'HEAD') response.end();
        else response.end(bytes);
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'Calmdownol_template.carton',
        source: readFileSync(bundledExamplePath),
      });
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: 'vendor',
  plugins: [serveBundledExample()],
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
