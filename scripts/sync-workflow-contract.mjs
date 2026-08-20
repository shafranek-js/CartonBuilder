/**
 * Strict synchronization command to pull the manifest-backed carton-workflow package
 * into CartonBuilder.
 * Requires explicit --source <path> to a built package directory containing package-manifest.json.
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

// 1. Verify all source package files against manifest
console.log(`Verifying ${manifest.files.length} package files in source...`);
for (const file of manifest.files) {
  const srcFile = path.join(packageSourceDir, file.path);
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

// 2. Clean destination directory
if (fs.existsSync(destDir)) {
  fs.rmSync(destDir, { recursive: true, force: true });
}
fs.mkdirSync(destDir, { recursive: true });

// 3. Copy files byte-for-byte without any modification
console.log(`Copying package files into ${destDir}...`);
for (const file of manifest.files) {
  const srcFile = path.join(packageSourceDir, file.path);
  const dstFile = path.join(destDir, file.path);
  fs.mkdirSync(path.dirname(dstFile), { recursive: true });
  fs.copyFileSync(srcFile, dstFile);
  console.log(`✓ Copied: src/workflow/${file.path}`);
}

// Copy manifest itself
fs.copyFileSync(manifestPath, path.join(destDir, "package-manifest.json"));
console.log("✓ Copied: src/workflow/package-manifest.json\n");

// 4. Verify copied files in destination
console.log("Verifying destination files...");
for (const file of manifest.files) {
  const dstFile = path.join(destDir, file.path);
  const bytes = fs.readFileSync(dstFile);
  const hash = sha256File(dstFile);
  if (bytes.length !== file.byteLength || hash !== file.sha256) {
    console.error(`Error: Destination file corrupted: ${file.path}`);
    process.exit(1);
  }
}

console.log("✓ All destination files match package manifest hashes byte-for-byte.");
console.log(`✓ Synced Package: ${manifest.packageName}@${manifest.packageVersion} (PBD commit ${manifest.pbdCommit})`);
console.log("\nCarton workflow contract synchronization completed successfully.");
