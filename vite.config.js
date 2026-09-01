import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';
import { defineConfig } from 'vite';

const bundledExamplePath = resolve('public/Calmdownol_template.carton');
const renderEnvironmentRoot = resolve('public/render-environments');
const showcaseRoot = resolve('public/showcase');

const renderEnvironmentContentTypes = Object.freeze({
  '.hdr': 'image/vnd.radiance',
  '.exr': 'application/vnd.openexr',
});

const showcaseContentTypes = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
});

function collectRenderEnvironmentFiles(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectRenderEnvironmentFiles(root, filePath);
    const extension = extname(entry.name).toLowerCase();
    if (!renderEnvironmentContentTypes[extension]) return [];
    return [{
      filePath,
      fileName: relative(root, filePath).split(sep).join('/'),
      contentType: renderEnvironmentContentTypes[extension],
    }];
  });
}

function isInside(root, filePath) {
  const rootWithSeparator = `${resolve(root)}${sep}`;
  return filePath === resolve(root) || filePath.startsWith(rootWithSeparator);
}

function collectShowcaseFiles(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectShowcaseFiles(root, filePath);
    if (!entry.isFile()) return [];
    return [{
      filePath,
      fileName: relative(root, filePath).split(sep).join('/'),
    }];
  });
}

function serveRenderEnvironments() {
  const middleware = (request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      next();
      return;
    }
    let requestPath = '';
    try {
      requestPath = decodeURIComponent(String(request.url || '').split('?')[0]).replace(/^\/+/, '');
    } catch {
      next();
      return;
    }
    if (!requestPath) {
      next();
      return;
    }
    const filePath = resolve(renderEnvironmentRoot, requestPath);
    if (!isInside(renderEnvironmentRoot, filePath)) {
      next();
      return;
    }
    const fileStat = statSync(filePath, { throwIfNoEntry: false });
    if (!fileStat?.isFile()) {
      next();
      return;
    }
    const extension = extname(filePath).toLowerCase();
    const contentType = renderEnvironmentContentTypes[extension];
    if (!contentType) {
      next();
      return;
    }
    const bytes = readFileSync(filePath);
    response.statusCode = 200;
    response.setHeader('Content-Type', contentType);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('Content-Length', bytes.byteLength);
    if (request.method === 'HEAD') response.end();
    else response.end(bytes);
  };

  return {
    name: 'serve-render-environments',
    configureServer(server) {
      server.middlewares.use('/render-environments', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/render-environments', middleware);
    },
    generateBundle() {
      for (const entry of collectRenderEnvironmentFiles(renderEnvironmentRoot)) {
        this.emitFile({
          type: 'asset',
          fileName: `render-environments/${entry.fileName}`,
          source: readFileSync(entry.filePath),
        });
      }
    },
  };
}

function serveShowcase() {
  const middleware = (request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      next();
      return;
    }
    let requestPath = '';
    try {
      requestPath = decodeURIComponent(String(request.url || '').split('?')[0]).replace(/^\/+/, '');
    } catch {
      next();
      return;
    }
    if (!requestPath) {
      next();
      return;
    }
    const filePath = resolve(showcaseRoot, requestPath);
    if (!isInside(showcaseRoot, filePath)) {
      next();
      return;
    }
    const fileStat = statSync(filePath, { throwIfNoEntry: false });
    if (!fileStat?.isFile()) {
      next();
      return;
    }
    const extension = extname(filePath).toLowerCase();
    const contentType = showcaseContentTypes[extension] || 'application/octet-stream';
    const bytes = readFileSync(filePath);
    response.statusCode = 200;
    response.setHeader('Content-Type', contentType);
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Content-Length', bytes.byteLength);
    if (request.method === 'HEAD') response.end();
    else response.end(bytes);
  };

  return {
    name: 'serve-showcase',
    configureServer(server) {
      server.middlewares.use('/showcase', middleware);
    },
    generateBundle() {
      for (const entry of collectShowcaseFiles(showcaseRoot)) {
        this.emitFile({
          type: 'asset',
          fileName: `showcase/${entry.fileName}`,
          source: readFileSync(entry.filePath),
        });
      }
    },
  };
}

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
  plugins: [serveBundledExample(), serveRenderEnvironments(), serveShowcase()],
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
