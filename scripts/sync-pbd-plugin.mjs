/**
 * Synchronization script for Packaging Box Designer plugin artifact into CartonBuilder.
 * Usage: node scripts/sync-pbd-plugin.mjs --source <path-to-pbd-plugin-dist>
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { atomicSyncManifestPackage } from "./lib/atomicManifestSync.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const vendorPluginsDir = path.resolve(rootDir, "vendor/plugins");
const schemaPath = path.resolve(rootDir, "schemas/plugins.manifest.v1.schema.json");

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);

const catalogSchema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const validateCatalog = ajv.compile(catalogSchema);

export function syncPbdPlugin(sourcePath) {
  if (!sourcePath) {
    throw new Error("Error: --source <path-to-plugin-directory> is required.");
  }
  const pluginSourceDir = path.resolve(sourcePath);
  console.log(`=== Syncing Packaging Box Designer plugin from ${pluginSourceDir} ===\n`);

  const manifestPath = path.join(pluginSourceDir, "plugin-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Plugin manifest not found at ${manifestPath}`);
  }

  const pluginManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (pluginManifest.id !== "packaging-box-designer") {
    throw new Error(`Invalid plugin ID: expected "packaging-box-designer", got "${pluginManifest.id}"`);
  }

  const targetPluginDir = path.join(vendorPluginsDir, pluginManifest.id, pluginManifest.version);

  // 1. Sync plugin files atomically
  atomicSyncManifestPackage({
    sourceDir: pluginSourceDir,
    destDir: targetPluginDir,
    manifestFilename: "plugin-manifest.json",
  });

  console.log(`✓ Plugin files atomically synced to: ${targetPluginDir}`);

  // 2. Update vendor/plugins/plugins.manifest.json catalog
  const catalogPath = path.join(vendorPluginsDir, "plugins.manifest.json");
  let catalog = {
    manifestVersion: "plugins.manifest.v1",
    description: "Vendored plugin catalog for CartonBuilder",
    plugins: [],
  };

  if (fs.existsSync(catalogPath)) {
    try {
      catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    } catch {}
  }

  // Upsert this plugin entry in the catalog
  const existingIdx = catalog.plugins.findIndex(
    (p) => p.id === pluginManifest.id && p.version === pluginManifest.version
  );

  if (existingIdx >= 0) {
    catalog.plugins[existingIdx] = pluginManifest;
  } else {
    catalog.plugins.push(pluginManifest);
  }

  // Sort plugins by id and version
  catalog.plugins.sort((a, b) => `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`));

  // Validate catalog against schema
  const valid = validateCatalog(catalog);
  if (!valid) {
    throw new Error(
      `Catalog validation failed: ${JSON.stringify(validateCatalog.errors, null, 2)}`
    );
  }

  fs.writeFileSync(
    catalogPath,
    (JSON.stringify(catalog, null, 2) + "\n").replace(/\r\n/g, "\n"),
    "utf8"
  );
  console.log(`✓ Updated plugins catalog at: ${catalogPath}`);

  // 3. Sync contract package into src/workflow for host code
  const contractSrc = path.join(targetPluginDir, "contract");
  if (fs.existsSync(contractSrc)) {
    atomicSyncManifestPackage({
      sourceDir: contractSrc,
      destDir: path.resolve(rootDir, "src/workflow"),
      manifestFilename: "package-manifest.json",
    });
    console.log("✓ Contract package synced into src/workflow/");
  }

  console.log("\nPlugin synchronization completed successfully.");
}

// CLI execution
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const sourceArgIndex = args.indexOf("--source");
  if (sourceArgIndex === -1 || !args[sourceArgIndex + 1]) {
    console.error("Error: --source <path-to-plugin-directory> is required.");
    process.exit(1);
  }

  try {
    syncPbdPlugin(args[sourceArgIndex + 1]);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
