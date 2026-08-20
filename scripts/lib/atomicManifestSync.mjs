/**
 * Reusable helper for secure, path-traversal-safe, and atomic manifest-backed package synchronization.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function sha256File(filepath) {
  const content = fs.readFileSync(filepath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function isPathSafe(baseDir, relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) return false;
  if (/^[a-zA-Z]:/.test(relativePath) || relativePath.startsWith("/") || relativePath.startsWith("\\")) return false;
  const normalized = path.normalize(relativePath);
  if (
    normalized.startsWith("..") ||
    normalized.includes(".." + path.sep) ||
    normalized.includes("../") ||
    normalized.includes("..\\")
  ) {
    return false;
  }
  const resolved = path.resolve(baseDir, normalized);
  const normalizedBase = path.normalize(baseDir);
  return resolved.startsWith(normalizedBase + path.sep) || resolved === normalizedBase;
}

/**
 * Synchronize a manifest-backed directory atomically into a destination directory.
 *
 * @param {object} options
 * @param {string} options.sourceDir
 * @param {string} options.destDir
 * @param {string} [options.manifestFilename="package-manifest.json"]
 * @returns {object} The parsed manifest
 */
export function atomicSyncManifestPackage({
  sourceDir,
  destDir,
  manifestFilename = "package-manifest.json",
}) {
  const packageSourceDir = path.resolve(sourceDir);
  const targetDestDir = path.resolve(destDir);

  if (!fs.existsSync(packageSourceDir)) {
    throw new Error(`Source directory "${packageSourceDir}" does not exist.`);
  }

  const manifestPath = path.join(packageSourceDir, manifestFilename);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest "${manifestPath}" not found.`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (err) {
    throw new Error(`Failed to parse manifest at "${manifestPath}": ${err.message}`);
  }

  const filesList = manifest.files;
  if (!Array.isArray(filesList) || filesList.length === 0) {
    throw new Error(`Invalid manifest at "${manifestPath}": missing or empty "files" array.`);
  }

  // 1. Verify and sanitize all manifest paths and source package files BEFORE touching destination
  for (const file of filesList) {
    if (!isPathSafe(packageSourceDir, file.path)) {
      throw new Error(`Security Error: Forbidden or traversal path in manifest: "${file.path}"`);
    }

    const srcFile = path.resolve(packageSourceDir, file.path);
    if (!fs.existsSync(srcFile)) {
      throw new Error(`Source file "${file.path}" missing from package.`);
    }
    const bytes = fs.readFileSync(srcFile);
    if (bytes.length !== file.byteLength) {
      throw new Error(
        `Byte length mismatch for "${file.path}": expected ${file.byteLength}, got ${bytes.length}.`
      );
    }
    const hash = sha256File(srcFile);
    if (hash !== file.sha256) {
      throw new Error(`SHA-256 mismatch for "${file.path}": expected ${file.sha256}, got ${hash}.`);
    }
  }

  // 2. Prepare staging directory as a sibling of target destination
  const destParent = path.dirname(targetDestDir);
  const destBase = path.basename(targetDestDir);
  fs.mkdirSync(destParent, { recursive: true });

  const stagingDir = path.resolve(
    destParent,
    `.${destBase}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingDir, { recursive: true });

  let activated = false;
  let backupDir = null;

  try {
    // 3. Copy files into staging directory
    for (const file of filesList) {
      if (!isPathSafe(stagingDir, file.path)) {
        throw new Error(`Security Error: Staging path traversal: "${file.path}"`);
      }
      const srcFile = path.resolve(packageSourceDir, file.path);
      const dstFile = path.resolve(stagingDir, file.path);
      fs.mkdirSync(path.dirname(dstFile), { recursive: true });
      fs.copyFileSync(srcFile, dstFile);
    }

    // Copy manifest into staging
    fs.copyFileSync(manifestPath, path.join(stagingDir, manifestFilename));

    // 4. Verify all files in staging directory
    for (const file of filesList) {
      const stagedFile = path.resolve(stagingDir, file.path);
      const bytes = fs.readFileSync(stagedFile);
      const hash = sha256File(stagedFile);
      if (bytes.length !== file.byteLength || hash !== file.sha256) {
        throw new Error(`Integrity Error: Staged file corrupted: ${file.path}`);
      }
    }

    // 5. Atomic activation of destination directory
    if (fs.existsSync(targetDestDir)) {
      backupDir = path.resolve(
        destParent,
        `.${destBase}.bak-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      fs.renameSync(targetDestDir, backupDir);
    }

    fs.renameSync(stagingDir, targetDestDir);
    activated = true;
  } catch (activationErr) {
    // Rollback on activation failure: restore backup if targetDestDir does not exist
    if (!activated && backupDir && fs.existsSync(backupDir) && !fs.existsSync(targetDestDir)) {
      try {
        fs.renameSync(backupDir, targetDestDir);
      } catch (rbErr) {
        console.error(`Fatal: Failed to restore backup during rollback: ${rbErr.message}`);
      }
    }

    if (fs.existsSync(stagingDir)) {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch {}
    }

    throw new Error(`Atomic sync failed: ${activationErr.message}`);
  }

  // 6. Post-activation backup cleanup (outside activation rollback)
  if (activated && backupDir && fs.existsSync(backupDir)) {
    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn(
        `Warning: Could not remove temporary backup directory at "${backupDir}": ${cleanupErr.message}`
      );
      console.warn("New destination remains active and fully functional.");
    }
  }

  return manifest;
}
