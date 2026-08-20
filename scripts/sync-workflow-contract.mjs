/**
 * Strict synchronization command to pull the manifest-backed carton-workflow package
 * into CartonBuilder.
 * Requires explicit --source <path> to a built package directory containing package-manifest.json.
 * Enforces strict path normalization/traversal checks and atomic staging replacement.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const destDir = path.resolve(rootDir, "src/workflow");

const args = process.argv.slice(2);
const sourceArgIndex = args.indexOf("--source");
if (sourceArgIndex === -1 || !args[sourceArgIndex + 1]) {
  console.error("Error: --source <path-to-package-directory> is required.");
  console.error("Example: node scripts/sync-workflow-contract.mjs --source ../Packaging\\ Box\\ Designer-stage1/dist/packages/carton-workflow-v1");
  process.exit(1);
}

const packageSourceDir = path.resolve(args[sourceArgIndex + 1]);
console.log(`Syncing carton-workflow package from: ${packageSourceDir}\n`);

if (!fs.existsSync(packageSourceDir)) {
  console.error(`Error: Source package directory "${packageSourceDir}" does not exist.`);
  process.exit(1);
}

const manifestPath = path.join(packageSourceDir, "package-manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`Error: Package manifest "${manifestPath}" not found.`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!manifest.packageName || !Array.isArray(manifest.files) || manifest.files.length === 0) {
  console.error("Error: Invalid or empty package manifest.");
  process.exit(1);
}

function sha256File(filepath) {
  const content = fs.readFileSync(filepath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function isPathSafe(baseDir, relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) return false;
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || normalized.includes(".." + path.sep)) return false;
  const resolved = path.resolve(baseDir, normalized);
  const normalizedBase = path.normalize(baseDir);
  return resolved.startsWith(normalizedBase + path.sep) || resolved === normalizedBase;
}

// 1. Verify and sanitize all manifest paths and source package files
console.log(`Verifying ${manifest.files.length} package files in source...`);
for (const file of manifest.files) {
  if (!isPathSafe(packageSourceDir, file.path)) {
    console.error(`Security Error: Forbidden or traversal path in manifest: "${file.path}"`);
    process.exit(1);
  }

  const srcFile = path.resolve(packageSourceDir, file.path);
  if (!fs.existsSync(srcFile)) {
    console.error(`Error: Source file "${file.path}" missing from package.`);
    process.exit(1);
  }
  const bytes = fs.readFileSync(srcFile);
  if (bytes.length !== file.byteLength) {
    console.error(`Error: Byte length mismatch for "${file.path}": expected ${file.byteLength}, got ${bytes.length}.`);
    process.exit(1);
  }
  const hash = sha256File(srcFile);
  if (hash !== file.sha256) {
    console.error(`Error: SHA-256 mismatch for "${file.path}": expected ${file.sha256}, got ${hash}.`);
    process.exit(1);
  }
}
console.log("✓ All source package files verified against manifest.\n");

// 2. Prepare staging directory for atomic replacement
const stagingDir = path.resolve(rootDir, `src/workflow.tmp-${Date.now()}`);
if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
fs.mkdirSync(stagingDir, { recursive: true });

try {
  // 3. Copy files into staging directory
  console.log(`Copying package files into staging directory...`);
  for (const file of manifest.files) {
    if (!isPathSafe(stagingDir, file.path)) {
      throw new Error(`Security Error: Staging path traversal: "${file.path}"`);
    }
    const srcFile = path.resolve(packageSourceDir, file.path);
    const dstFile = path.resolve(stagingDir, file.path);
    fs.mkdirSync(path.dirname(dstFile), { recursive: true });
    fs.copyFileSync(srcFile, dstFile);
    console.log(`✓ Copied: ${file.path}`);
  }

  // Copy manifest to staging
  fs.copyFileSync(manifestPath, path.join(stagingDir, "package-manifest.json"));
  console.log("✓ Copied: package-manifest.json\n");

  // 4. Verify all files in staging directory
  console.log("Verifying staged files before activation...");
  for (const file of manifest.files) {
    const stagedFile = path.resolve(stagingDir, file.path);
    const bytes = fs.readFileSync(stagedFile);
    const hash = sha256File(stagedFile);
    if (bytes.length !== file.byteLength || hash !== file.sha256) {
      throw new Error(`Integrity Error: Staged file corrupted: ${file.path}`);
    }
  }
  console.log("✓ Staging verification passed.\n");

  // 5. Atomic replacement of destination directory
  const backupDir = path.resolve(rootDir, `src/workflow.bak-${Date.now()}`);
  if (fs.existsSync(destDir)) {
    fs.renameSync(destDir, backupDir);
  }

  try {
    fs.renameSync(stagingDir, destDir);
    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  } catch (renameErr) {
    if (fs.existsSync(backupDir)) {
      fs.renameSync(backupDir, destDir);
    }
    throw renameErr;
  }

  console.log("✓ Destination directory atomically updated.");
  console.log(`✓ Synced Package: ${manifest.packageName}@${manifest.packageVersion} (PBD commit ${manifest.pbdCommit})`);
  console.log("\nCarton workflow contract synchronization completed successfully.");
} catch (err) {
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  console.error(`\nSync Failed: ${err.message}`);
  console.error("Existing src/workflow was preserved intact.");
  process.exit(1);
}
