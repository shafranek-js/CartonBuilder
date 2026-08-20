/**
 * Strict build integrity gate for vendored plugins in CartonBuilder.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPathSafe, isPathWithin } from "./lib/atomicManifestSync.mjs";
import {
  assertValidPluginsCatalog,
  canonicalPluginManifestPath,
  createPluginManifestValidators,
} from "./lib/pluginManifests.mjs";
import { inspectPluginPackage } from "./lib/pluginPackageVerification.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(__dirname, "..");

export function verifyVendoredPlugins({ rootDir = defaultRootDir, logger = console } = {}) {
  const hostRoot = path.resolve(rootDir);
  const vendorPluginsDir = path.resolve(hostRoot, "vendor/plugins");
  const catalogPath = path.join(vendorPluginsDir, "plugins.manifest.json");
  const issues = [];
  logger.log("=== Verifying Vendored Plugins Integrity Gate ===\n");

  let validators;
  try {
    validators = createPluginManifestValidators(hostRoot);
  } catch (error) {
    return { valid: false, issues: [`Plugin schemas could not be compiled: ${error.message}`] };
  }

  if (!fs.existsSync(catalogPath)) {
    return { valid: false, issues: [`Catalog manifest missing at ${catalogPath}`] };
  }

  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    assertValidPluginsCatalog(catalog, validators.validateCatalog);
  } catch (error) {
    return { valid: false, issues: [error.message] };
  }

  logger.log(`Plugins catalog schema and identity uniqueness verified (${catalog.plugins.length} plugins).\n`);
  const registeredPluginPaths = new Set();

  for (const entry of catalog.plugins) {
    const plugin = entry.plugin;
    const identity = `${plugin.id}@${plugin.version}`;
    const canonicalManifestPath = canonicalPluginManifestPath(plugin);
    logger.log(`Verifying plugin: ${identity}...`);

    if (!isPathSafe(vendorPluginsDir, entry.manifestPath)) {
      issues.push(`Unsafe catalog manifestPath for ${identity}: "${entry.manifestPath}".`);
      continue;
    }
    if (entry.manifestPath !== canonicalManifestPath) {
      issues.push(
        `Non-canonical catalog manifestPath for ${identity}: expected "${canonicalManifestPath}", got "${entry.manifestPath}".`
      );
      continue;
    }

    const manifestPath = path.resolve(vendorPluginsDir, entry.manifestPath);
    const pluginDir = path.dirname(manifestPath);
    if (!isPathWithin(vendorPluginsDir, pluginDir, { allowBase: false })) {
      issues.push(`Plugin directory escapes vendor/plugins for ${identity}.`);
      continue;
    }
    registeredPluginPaths.add(
      path.relative(vendorPluginsDir, pluginDir).replace(/\\/g, "/")
    );

    const inspection = inspectPluginPackage({
      pluginDir,
      validatePlugin: validators.validatePlugin,
      catalogEntry: entry,
      scanNetwork: true,
    });
    for (const issue of inspection.issues) issues.push(`${identity}: ${issue}`);
    if (inspection.valid) {
      logger.log(
        `  Standalone manifest, ${plugin.files.length} files, embedded contract, CSP and static offline references verified.`
      );
    }
  }

  if (fs.existsSync(vendorPluginsDir)) {
    const rootEntries = fs.readdirSync(vendorPluginsDir, { withFileTypes: true });
    for (const rootEntry of rootEntries.filter((entry) => entry.isFile())) {
      if (rootEntry.name !== "plugins.manifest.json") {
        issues.push(`Unauthorized file in vendor/plugins root: "${rootEntry.name}".`);
      }
    }
    for (const idEntry of rootEntries.filter((entry) => entry.isDirectory())) {
      const idDir = path.join(vendorPluginsDir, idEntry.name);
      for (const versionEntry of fs
        .readdirSync(idDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())) {
        const relativeDir = `${idEntry.name}/${versionEntry.name}`;
        if (!registeredPluginPaths.has(relativeDir)) {
          issues.push(`Unregistered plugin directory found on disk: "vendor/plugins/${relativeDir}".`);
        }
      }
    }
  }

  if (issues.length) {
    logger.error("\n[FAIL] Vendored plugins verification failed:");
    for (const issue of issues) logger.error(`  - ${issue}`);
    return { valid: false, issues };
  }

  logger.log("\nAll vendored plugin integrity checks passed.");
  logger.log("Static network-reference scan passed; runtime offline behavior is covered by Playwright.");
  return { valid: true, issues: [] };
}
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const result = verifyVendoredPlugins();
  if (!result.valid) process.exit(1);
}
