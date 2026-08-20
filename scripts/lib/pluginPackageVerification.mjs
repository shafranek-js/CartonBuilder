import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isPathSafe, sha256File } from "./atomicManifestSync.mjs";
import {
  canonicalPluginManifestPath,
  catalogEntryMatchesManifest,
  manifestArtifactFromBytes,
} from "./pluginManifests.mjs";
import { findForbiddenNetworkReferences } from "./offlinePolicy.mjs";

function getAllRelativeFiles(dir, baseDir = dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files = files.concat(getAllRelativeFiles(fullPath, baseDir));
    else files.push(path.relative(baseDir, fullPath).replace(/\\/g, "/"));
  }
  return files.sort();
}

function readCspMeta(html) {
  const meta = html.match(/<meta\s+[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i)?.[0];
  if (!meta) return null;
  return meta.match(/\bcontent="([^"]*)"/i)?.[1] ?? meta.match(/\bcontent='([^']*)'/i)?.[1] ?? null;
}

export function inspectPluginPackage({
  pluginDir,
  validatePlugin,
  catalogEntry = null,
  scanNetwork = true,
}) {
  const packageDir = path.resolve(pluginDir);
  const issues = [];
  const manifestPath = path.join(packageDir, "plugin-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return { valid: false, issues: [`Plugin manifest missing: ${manifestPath}`] };
  }

  let manifestBytes;
  let manifest;
  try {
    manifestBytes = fs.readFileSync(manifestPath);
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    return { valid: false, issues: [`Plugin manifest parse failed: ${error.message}`] };
  }

  if (!validatePlugin(manifest)) {
    issues.push(`Standalone plugin manifest schema failed: ${JSON.stringify(validatePlugin.errors || [])}`);
    return { valid: false, issues, manifest, manifestBytes };
  }

  if (catalogEntry) {
    if (!catalogEntryMatchesManifest(catalogEntry, manifest, manifestBytes)) {
      issues.push("Catalog entry does not match plugin-manifest.json byte integrity and semantic content.");
    }
  }

  const declared = new Set(["plugin-manifest.json"]);
  const records = new Map();
  for (const file of manifest.files) {
    if (records.has(file.path)) {
      issues.push(`Duplicate plugin file record: "${file.path}".`);
      continue;
    }
    records.set(file.path, file);
    declared.add(file.path);
    if (!isPathSafe(packageDir, file.path)) {
      issues.push(`Unsafe plugin file path: "${file.path}".`);
      continue;
    }
    const fullPath = path.resolve(packageDir, file.path);
    if (!fs.existsSync(fullPath)) {
      issues.push(`Declared plugin file missing: "${file.path}".`);
      continue;
    }
    if (fs.lstatSync(fullPath).isSymbolicLink()) {
      issues.push(`Symbolic links are forbidden in plugin packages: "${file.path}".`);
      continue;
    }
    const bytes = fs.readFileSync(fullPath);
    if (bytes.length !== file.byteLength) {
      issues.push(`Byte length mismatch for "${file.path}".`);
    }
    if (sha256File(fullPath) !== file.sha256) {
      issues.push(`SHA-256 mismatch for "${file.path}".`);
    }

    if (scanNetwork && /\.(?:html|js|mjs|svg|css|json)$/i.test(file.path)) {
      for (const finding of findForbiddenNetworkReferences(bytes.toString("utf8"))) {
        issues.push(
          `Forbidden external network reference in ${file.path}:${finding.line}: ${finding.reference}`
        );
      }
    }
  }

  if (fs.existsSync(packageDir)) {
    for (const diskFile of getAllRelativeFiles(packageDir)) {
      if (!declared.has(diskFile)) issues.push(`Undeclared plugin file on disk: "${diskFile}".`);
    }
  }

  const entrypoint = records.get(manifest.entrypoint);
  if (!entrypoint) {
    issues.push(`Entrypoint is not declared in files: "${manifest.entrypoint}".`);
  } else if (!isDeepStrictEqual(manifest.artifact, {
    byteLength: entrypoint.byteLength,
    sha256: entrypoint.sha256,
  })) {
    issues.push("Plugin artifact record does not match the declared entrypoint file.");
  }

  if (entrypoint && isPathSafe(packageDir, manifest.entrypoint)) {
    const entrypointPath = path.resolve(packageDir, manifest.entrypoint);
    if (fs.existsSync(entrypointPath)) {
      const enforcedCsp = readCspMeta(fs.readFileSync(entrypointPath, "utf8"));
      if (enforcedCsp !== manifest.runtime.csp) {
        issues.push("Plugin entrypoint does not enforce the CSP declared in its manifest.");
      }
    }
  }

  const contractRecord = records.get("contract/package-manifest.json");
  const contractPath = path.join(packageDir, "contract/package-manifest.json");
  if (!contractRecord || !fs.existsSync(contractPath)) {
    issues.push("Embedded workflow package manifest is missing or undeclared.");
  } else {
    try {
      const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
      if (contract.contractVersion !== manifest.contracts.workflow) {
        issues.push("Embedded workflow contract version does not match plugin manifest.");
      }
      if (contract.pbdCommit !== manifest.sourceCommit) {
        issues.push("Embedded workflow contract commit does not match plugin sourceCommit.");
      }
      const contractPaths = new Set(contract.files.map((file) => file.path));
      for (const file of contract.files) {
        const embedded = records.get(`contract/${file.path}`);
        if (
          !embedded ||
          embedded.byteLength !== file.byteLength ||
          embedded.sha256 !== file.sha256
        ) {
          issues.push(`Embedded workflow contract record mismatch: "${file.path}".`);
        }
      }
      for (const pluginPath of records.keys()) {
        if (
          pluginPath.startsWith("contract/") &&
          pluginPath !== "contract/package-manifest.json" &&
          !contractPaths.has(pluginPath.slice("contract/".length))
        ) {
          issues.push(`Plugin contains a contract file not declared by package-manifest.json: "${pluginPath}".`);
        }
      }
    } catch (error) {
      issues.push(`Embedded workflow package manifest parse failed: ${error.message}`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    manifest,
    manifestBytes,
    manifestArtifact: manifestArtifactFromBytes(manifestBytes),
    canonicalManifestPath: canonicalPluginManifestPath(manifest),
  };
}
