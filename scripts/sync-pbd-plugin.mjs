/**
 * Transactionally vendors one validated Packaging Box Designer plugin package.
 * Usage: node scripts/sync-pbd-plugin.mjs --source <path-to-pbd-plugin-dist>
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  activatePreparedReplacements,
  cleanupPreparedReplacements,
  isPathWithin,
  isSafePathSegment,
  prepareFileReplacement,
  prepareManifestPackageReplacement,
  verifyManifestPackage,
} from "./lib/atomicManifestSync.mjs";
import {
  assertValidPluginManifest,
  assertValidPluginsCatalog,
  buildCatalogEntry,
  createPluginManifestValidators,
} from "./lib/pluginManifests.mjs";
import { inspectPluginPackage } from "./lib/pluginPackageVerification.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(__dirname, "..");

function readJsonStrict(filepath, label) {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf8"));
  } catch (error) {
    throw new Error(`${label} parse failed at "${filepath}": ${error.message}`);
  }
}
export function syncPbdPlugin(sourcePath, { rootDir = defaultRootDir } = {}) {
  if (!sourcePath) throw new Error("Error: --source <path-to-plugin-directory> is required.");

  const hostRoot = path.resolve(rootDir);
  const vendorPluginsDir = path.resolve(hostRoot, "vendor/plugins");
  const workflowDestDir = path.resolve(hostRoot, "src/workflow");
  const pluginSourceDir = path.resolve(sourcePath);
  const manifestPath = path.join(pluginSourceDir, "plugin-manifest.json");
  const catalogPath = path.join(vendorPluginsDir, "plugins.manifest.json");
  const { validatePlugin, validateCatalog } = createPluginManifestValidators(hostRoot);

  if (!fs.existsSync(manifestPath)) throw new Error(`Plugin manifest not found at ${manifestPath}`);
  const pluginManifest = readJsonStrict(manifestPath, "Plugin manifest");
  assertValidPluginManifest(pluginManifest, validatePlugin);

  if (pluginManifest.id !== "packaging-box-designer") {
    throw new Error(
      `Invalid plugin ID: expected "packaging-box-designer", got "${pluginManifest.id}"`
    );
  }
  if (!isSafePathSegment(pluginManifest.id) || !isSafePathSegment(pluginManifest.version)) {
    throw new Error("Security Error: Plugin id and version must each be one safe path segment.");
  }

  const targetPluginDir = path.resolve(
    vendorPluginsDir,
    pluginManifest.id,
    pluginManifest.version
  );
  if (!isPathWithin(vendorPluginsDir, targetPluginDir, { allowBase: false })) {
    throw new Error("Security Error: Computed plugin destination escapes vendor/plugins.");
  }

  verifyManifestPackage({
    sourceDir: pluginSourceDir,
    manifestFilename: "plugin-manifest.json",
    rejectUndeclared: true,
  });
  const inspection = inspectPluginPackage({
    pluginDir: pluginSourceDir,
    validatePlugin,
    scanNetwork: true,
  });
  if (!inspection.valid) {
    throw new Error(`Plugin package preflight failed:\n- ${inspection.issues.join("\n- ")}`);
  }

  const contractSourceDir = path.join(pluginSourceDir, "contract");
  verifyManifestPackage({
    sourceDir: contractSourceDir,
    manifestFilename: "package-manifest.json",
    rejectUndeclared: true,
  });

  let catalog = {
    manifestVersion: "plugins.manifest.v1",
    description: "Vendored plugin catalog for CartonBuilder",
    plugins: [],
  };
  if (fs.existsSync(catalogPath)) catalog = readJsonStrict(catalogPath, "Plugins catalog");

  if (!Array.isArray(catalog.plugins)) {
    throw new Error("Plugins catalog must contain a plugins array.");
  }
  const legacyEntries = catalog.plugins.filter((entry) => !entry.plugin);
  if (legacyEntries.length) {
    for (const entry of legacyEntries) {
      if (entry.id !== pluginManifest.id || entry.version !== pluginManifest.version) {
        throw new Error(
          `Legacy catalog entry ${entry.id}@${entry.version} requires an explicit migration before sync.`
        );
      }
    }
    catalog.plugins = catalog.plugins.filter((entry) => entry.plugin);
  } else if (catalog.plugins.length) {
    assertValidPluginsCatalog(catalog, validateCatalog);
  }

  const catalogEntry = buildCatalogEntry(pluginManifest, inspection.manifestBytes);
  const identity = `${pluginManifest.id}@${pluginManifest.version}`;
  const matchingIndexes = catalog.plugins
    .map((entry, index) => ({ identity: `${entry.plugin.id}@${entry.plugin.version}`, index }))
    .filter((entry) => entry.identity === identity)
    .map((entry) => entry.index);
  if (matchingIndexes.length > 1) throw new Error(`Duplicate plugin identity in catalog: ${identity}`);
  if (matchingIndexes.length === 1) catalog.plugins[matchingIndexes[0]] = catalogEntry;
  else catalog.plugins.push(catalogEntry);
  catalog.plugins.sort((a, b) =>
    `${a.plugin.id}@${a.plugin.version}`.localeCompare(
      `${b.plugin.id}@${b.plugin.version}`
    )
  );
  assertValidPluginsCatalog(catalog, validateCatalog);
  const catalogBytes = Buffer.from(
    (JSON.stringify(catalog, null, 2) + "\n").replace(/\r\n/g, "\n"),
    "utf8"
  );

  const replacements = [];
  try {
    replacements.push(
      prepareManifestPackageReplacement({
        sourceDir: pluginSourceDir,
        destDir: targetPluginDir,
        manifestFilename: "plugin-manifest.json",
        allowedDestinationRoot: vendorPluginsDir,
        rejectUndeclared: true,
      })
    );
    replacements.push(
      prepareManifestPackageReplacement({
        sourceDir: contractSourceDir,
        destDir: workflowDestDir,
        manifestFilename: "package-manifest.json",
        allowedDestinationRoot: hostRoot,
        rejectUndeclared: true,
      })
    );
    replacements.push(
      prepareFileReplacement({
        destFile: catalogPath,
        content: catalogBytes,
        allowedDestinationRoot: vendorPluginsDir,
      })
    );
    activatePreparedReplacements(replacements);
  } catch (error) {
    cleanupPreparedReplacements(replacements);
    throw error;
  }

  console.log(`Plugin files synced to: ${targetPluginDir}`);
  console.log(`Workflow contract synced to: ${workflowDestDir}`);
  console.log(`Plugins catalog updated at: ${catalogPath}`);
  console.log("Plugin synchronization completed transactionally.");
  return { pluginManifest, catalogEntry };
}

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
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
