import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createPluginManifestValidators,
  assertValidPluginManifest,
  assertValidPluginsCatalog,
  buildCatalogEntry
} from './lib/pluginManifests.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const pluginDir = path.resolve(rootDir, 'vendor/plugins/carton-fold-viewer/2.4.0');
const runtimeDir = path.resolve(pluginDir, 'runtime');

function sha256File(filepath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filepath)).digest('hex');
}

function updateFileRecords(records, baseDir) {
  for (const record of records) {
    const fullPath = path.resolve(baseDir, record.path);
    if (fs.existsSync(fullPath)) {
      record.byteLength = fs.statSync(fullPath).size;
      record.sha256 = sha256File(fullPath);
    }
  }
}

// 1. Update runtime/package-manifest.json
const runtimeManifestPath = path.join(runtimeDir, 'package-manifest.json');
if (fs.existsSync(runtimeManifestPath)) {
  const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, 'utf8'));
  updateFileRecords(runtimeManifest.files, runtimeDir);
  fs.writeFileSync(runtimeManifestPath, JSON.stringify(runtimeManifest, null, 2) + '\n', 'utf8');
  console.log('Updated runtime package-manifest.json');
}

// 2. Update plugin-manifest.json
const pluginManifestPath = path.join(pluginDir, 'plugin-manifest.json');
const pluginManifest = JSON.parse(fs.readFileSync(pluginManifestPath, 'utf8'));
updateFileRecords(pluginManifest.files, pluginDir);

const indexHtmlPath = path.join(pluginDir, 'index.html');
pluginManifest.artifact = {
  byteLength: fs.statSync(indexHtmlPath).size,
  sha256: sha256File(indexHtmlPath)
};

const { validatePlugin, validateCatalog } = createPluginManifestValidators(rootDir);
assertValidPluginManifest(pluginManifest, validatePlugin);

const manifestBytes = Buffer.from(JSON.stringify(pluginManifest, null, 2) + '\n', 'utf8');
fs.writeFileSync(pluginManifestPath, manifestBytes);
console.log('Updated plugin-manifest.json');

// 3. Update vendor/plugins/plugins.manifest.json
const catalogPath = path.resolve(rootDir, 'vendor/plugins/plugins.manifest.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

const entryIdx = catalog.plugins.findIndex(
  p => p.plugin.id === 'carton-fold-viewer' && p.plugin.version === '2.4.0'
);
if (entryIdx >= 0) {
  catalog.plugins[entryIdx] = buildCatalogEntry(pluginManifest, manifestBytes);
} else {
  catalog.plugins.push(buildCatalogEntry(pluginManifest, manifestBytes));
}

assertValidPluginsCatalog(catalog, validateCatalog);
fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
console.log('Updated plugins.manifest.json');
