/**
 * Strict synchronization command to pull the manifest-backed carton-workflow package
 * into CartonBuilder.
 * Requires explicit --source <path> to a built package directory containing package-manifest.json.
 * Enforces strict path normalization/traversal checks, atomic staging replacement, and resilient rollback.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const destDir = path.resolve(rootDir, "src/workflow");

function sha256File(filepath) {
  const content = fs.readFileSync(filepath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function isPathSafe(baseDir, relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) return false;
  if (/^[a-zA-Z]:/.test(relativePath) || relativePath.startsWith("/") || relativePath.startsWith("\\")) return false;
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || normalized.includes(".." + path.sep) || normalized.includes("../") || normalized.includes("..\\")) {
    return false;
  }
  const resolved = path.resolve(baseDir, normalized);
  const normalizedBase = path.normalize(baseDir);
  return resolved.startsWith(normalizedBase + path.sep) || resolved === normalizedBase;
}

export function syncWorkflowContract(sourcePath, customDestDir = destDir) {
  if (!sourcePath) {
    throw new Error("Error: --source <path-to-package-directory> is required.");
  }

  const packageSourceDir = path.resolve(sourcePath);
  const destinationDir = path.resolve(customDestDir);
  const destinationParent = path.dirname(destinationDir);
  const destinationName = path.basename(destinationDir);
  console.log(`Syncing carton-workflow package from: ${packageSourceDir}\n`);

  if (!fs.existsSync(packageSourceDir)) {
    throw new Error(`Error: Source package directory "${packageSourceDir}" does not exist.`);
  }

  const manifestPath = path.join(packageSourceDir, "package-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Error: Package manifest "${manifestPath}" not found.`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (err) {
    throw new Error(`Error: Failed to parse package manifest: ${err.message}`);
  }

  if (!manifest.packageName || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("Error: Invalid or empty package manifest.");
  }

  // 1. Verify and sanitize all manifest paths and source package files BEFORE touching destination
  console.log(`Verifying ${manifest.files.length} package files in source...`);
  for (const file of manifest.files) {
    if (!isPathSafe(packageSourceDir, file.path)) {
      throw new Error(`Security Error: Forbidden or traversal path in manifest: "${file.path}"`);
    }

    const srcFile = path.resolve(packageSourceDir, file.path);
    if (!fs.existsSync(srcFile)) {
      throw new Error(`Error: Source file "${file.path}" missing from package.`);
    }
    const bytes = fs.readFileSync(srcFile);
    if (bytes.length !== file.byteLength) {
      throw new Error(`Error: Byte length mismatch for "${file.path}": expected ${file.byteLength}, got ${bytes.length}.`);
    }
    const hash = sha256File(srcFile);
    if (hash !== file.sha256) {
      throw new Error(`Error: SHA-256 mismatch for "${file.path}": expected ${file.sha256}, got ${hash}.`);
    }
  }
  console.log("✓ All source package files verified against manifest.\n");

  // 2. Prepare staging directory for atomic replacement
  const stagingDir = path.join(
    destinationParent,
    `.${destinationName}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingDir, { recursive: true });

  let activated = false;
  let backupDir = null;

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
    }

    // Copy manifest to staging
    fs.copyFileSync(manifestPath, path.join(stagingDir, "package-manifest.json"));
    console.log(`✓ Successfully staged ${manifest.files.length} package files.\n`);

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

    // 5. Atomic activation of destination directory
    if (fs.existsSync(destinationDir)) {
      backupDir = path.join(
        destinationParent,
        `.${destinationName}.bak-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      fs.renameSync(destinationDir, backupDir);
    }

    fs.renameSync(stagingDir, destinationDir);
    activated = true;
    console.log("✓ Destination directory atomically activated.");
  } catch (activationErr) {
    // Rollback on activation failure: restore backup if destination does not exist
    if (!activated && backupDir && fs.existsSync(backupDir) && !fs.existsSync(destinationDir)) {
      try {
        fs.renameSync(backupDir, destinationDir);
        console.log("✓ Rollback successful: restored original destination.");
      } catch (rbErr) {
        console.error(`Fatal: Failed to restore backup during rollback: ${rbErr.message}`);
      }
    }

    if (fs.existsSync(stagingDir)) {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch {}
    }

    throw new Error(`Sync Failed: ${activationErr.message}`);
  }

  // 6. Post-activation backup cleanup (outside activation rollback)
  if (activated && backupDir && fs.existsSync(backupDir)) {
    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn(`Warning: Could not remove temporary backup directory at "${backupDir}": ${cleanupErr.message}`);
      console.warn("New destination remains active and fully functional.");
    }
  }

  console.log(`✓ Synced Package: ${manifest.packageName}@${manifest.packageVersion} (PBD commit ${manifest.pbdCommit})`);
  console.log("\nCarton workflow contract synchronization completed successfully.");
  return manifest;
}

// CLI entrypoint execution
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const sourceArgIndex = args.indexOf("--source");
  if (sourceArgIndex === -1 || !args[sourceArgIndex + 1]) {
    console.error("Error: --source <path-to-package-directory> is required.");
    console.error("Example: node scripts/sync-workflow-contract.mjs --source ../Packaging\\ Box\\ Designer-stage1/dist/packages/carton-workflow-v1");
    process.exit(1);
  }

  try {
    syncWorkflowContract(args[sourceArgIndex + 1]);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
