/**
 * Strict build integrity gate for vendored plugins in CartonBuilder.
 * Runs automatically prior to production build (`npm run plugins:verify`).
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { isPathSafe } from "./lib/atomicManifestSync.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const vendorPluginsDir = path.resolve(rootDir, "vendor/plugins");
const schemaPath = path.resolve(rootDir, "schemas/plugins.manifest.v1.schema.json");

function sha256File(filepath) {
  const content = fs.readFileSync(filepath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function getAllRelativeFiles(dir, baseDir = dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getAllRelativeFiles(fullPath, baseDir));
    } else {
      results.push(path.relative(baseDir, fullPath).replace(/\\/g, "/"));
    }
  }
  return results.sort();
}

const FORBIDDEN_NETWORK_PATTERNS = [
  /https?:\/\//i,
  /\/\/cdn\./i,
  /jsdelivr\.net/i,
  /unpkg\.com/i,
  /cdnjs\.cloudflare\.com/i,
  /ajax\.googleapis\.com/i,
];

export function verifyVendoredPlugins() {
  const issues = [];
  console.log("=== Verifying Vendored Plugins Integrity Gate ===\n");

  if (!fs.existsSync(schemaPath)) {
    console.error(`[FATAL] Schema not found at ${schemaPath}`);
    process.exit(1);
  }

  const catalogSchema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const validateCatalog = ajv.compile(catalogSchema);

  const catalogPath = path.join(vendorPluginsDir, "plugins.manifest.json");
  if (!fs.existsSync(catalogPath)) {
    issues.push(`Catalog manifest missing at ${catalogPath}`);
    console.error(`[FAIL] ${catalogPath} not found.`);
    return { valid: false, issues };
  }

  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  } catch (err) {
    issues.push(`Failed to parse ${catalogPath}: ${err.message}`);
    console.error(`[FAIL] ${catalogPath} is malformed.`);
    return { valid: false, issues };
  }

  // 1. Schema validation
  const validSchema = validateCatalog(catalog);
  if (!validSchema) {
    for (const err of validateCatalog.errors || []) {
      issues.push(`[Schema Error] ${err.instancePath} ${err.message}`);
    }
    console.error("[FAIL] plugins.manifest.json failed schema validation:");
    console.error(JSON.stringify(validateCatalog.errors, null, 2));
    return { valid: false, issues };
  }

  console.log(`✓ plugins.manifest.json matches schema (${catalog.plugins.length} registered plugins).\n`);

  // 2. Verify each plugin and its contents
  const registeredPluginPaths = new Set();

  for (const plugin of catalog.plugins) {
    console.log(`Verifying plugin: ${plugin.id}@${plugin.version}...`);
    const pluginDir = path.join(vendorPluginsDir, plugin.id, plugin.version);
    registeredPluginPaths.add(path.relative(vendorPluginsDir, pluginDir).replace(/\\/g, "/"));

    if (!fs.existsSync(pluginDir)) {
      issues.push(`Plugin directory missing: ${pluginDir}`);
      continue;
    }

    // Check entrypoint
    if (!isPathSafe(pluginDir, plugin.entrypoint)) {
      issues.push(`Unsafe or traversal entrypoint in ${plugin.id}@${plugin.version}: "${plugin.entrypoint}"`);
    } else {
      const entrypointFile = path.resolve(pluginDir, plugin.entrypoint);
      if (!fs.existsSync(entrypointFile)) {
        issues.push(`Entrypoint missing in ${plugin.id}@${plugin.version}: "${plugin.entrypoint}"`);
      }
    }

    // Check declared files
    const declaredFiles = new Set();
    declaredFiles.add("plugin-manifest.json");

    for (const file of plugin.files) {
      declaredFiles.add(file.path);

      if (!isPathSafe(pluginDir, file.path)) {
        issues.push(`Unsafe or traversal path in ${plugin.id}@${plugin.version}: "${file.path}"`);
        continue;
      }

      const fullFilePath = path.resolve(pluginDir, file.path);
      if (!fs.existsSync(fullFilePath)) {
        issues.push(`File missing in ${plugin.id}@${plugin.version}: "${file.path}"`);
        continue;
      }

      const bytes = fs.readFileSync(fullFilePath);
      if (bytes.length !== file.byteLength) {
        issues.push(
          `Byte length mismatch in ${plugin.id}@${plugin.version} for "${file.path}": declared ${file.byteLength}, actual ${bytes.length}`
        );
      }

      const hash = sha256File(fullFilePath);
      if (hash !== file.sha256) {
        issues.push(
          `SHA-256 hash mismatch in ${plugin.id}@${plugin.version} for "${file.path}": declared ${file.sha256}, actual ${hash}`
        );
      }

      // Check text files for forbidden external network dependencies
      if (/\.(html|js|mjs|svg|css)$/i.test(file.path)) {
        const textContent = bytes.toString("utf8");
        for (const pattern of FORBIDDEN_NETWORK_PATTERNS) {
          // Allow XML namespaces (http://www.w3.org/2000/svg) and JSON schema URLs ($schema)
          const lines = textContent.split("\n");
          for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            if (
              line.includes("xmlns=") ||
              line.includes("xmlns:") ||
              line.includes("http://www.w3.org/") ||
              line.includes("https://json-schema.org/") ||
              line.includes("https://cartonbuilder.dev/")
            ) {
              continue;
            }
            if (pattern.test(line)) {
              issues.push(
                `Forbidden external network reference found in ${plugin.id}@${plugin.version} (${file.path}:${lineNum + 1}): "${line.trim()}"`
              );
              break;
            }
          }
        }
      }
    }

    // Check for undeclared extra files on disk
    const diskFiles = getAllRelativeFiles(pluginDir);
    for (const diskFile of diskFiles) {
      if (!declaredFiles.has(diskFile)) {
        issues.push(`Undeclared file found on disk in ${plugin.id}@${plugin.version}: "${diskFile}"`);
      }
    }

    console.log(`  ✓ ${plugin.files.length} declared files verified byte-for-byte.`);
  }

  // 3. Check for undeclared plugin directories in vendor/plugins
  if (fs.existsSync(vendorPluginsDir)) {
    const pluginIds = fs.readdirSync(vendorPluginsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const idEntry of pluginIds) {
      const idDir = path.join(vendorPluginsDir, idEntry.name);
      const versionEntries = fs.readdirSync(idDir, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const verEntry of versionEntries) {
        const relDir = `${idEntry.name}/${verEntry.name}`;
        if (!registeredPluginPaths.has(relDir)) {
          issues.push(`Unregistered plugin directory found on disk: "vendor/plugins/${relDir}"`);
        }
      }
    }
  }

  const passed = issues.length === 0;
  if (!passed) {
    console.error("\n[FAIL] Vendored plugins verification failed with errors:");
    for (const issue of issues) {
      console.error(`  - ${issue}`);
    }
    return { valid: false, issues };
  }

  console.log("\n========================================================");
  console.log(`ALL ${catalog.plugins.length} VENDORED PLUGINS VERIFIED CLEANLY (100% OFFLINE).`);
  console.log("========================================================\n");
  return { valid: true, issues: [] };
}

// CLI execution
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const result = verifyVendoredPlugins();
  if (!result.valid) {
    process.exit(1);
  }
}
