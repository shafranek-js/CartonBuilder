/**
 * Reusable helpers for verified, traversal-safe and transactional package replacement.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function sha256File(filepath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filepath)).digest("hex");
}
export function isPathWithin(baseDir, candidatePath, { allowBase = true } = {}) {
  const base = path.resolve(baseDir);
  const candidate = path.resolve(candidatePath);
  return (allowBase && candidate === base) || candidate.startsWith(base + path.sep);
}

export function isPathSafe(baseDir, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    /^[A-Za-z]:/.test(relativePath) ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\")
  ) {
    return false;
  }
  return isPathWithin(baseDir, path.resolve(baseDir, relativePath), { allowBase: false });
}

export function isSafePathSegment(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !path.isAbsolute(value) &&
    !/^[A-Za-z]:/.test(value)
  );
}

function assertDestinationAllowed(destDir, allowedDestinationRoot) {
  if (
    allowedDestinationRoot &&
    !isPathWithin(allowedDestinationRoot, destDir, { allowBase: false })
  ) {
    throw new Error(
      `Security Error: Destination "${path.resolve(destDir)}" escapes allowed root "${path.resolve(allowedDestinationRoot)}".`
    );
  }
}

function getAllRelativeFiles(dir, baseDir = dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files = files.concat(getAllRelativeFiles(fullPath, baseDir));
    else files.push(path.relative(baseDir, fullPath).replace(/\\/g, "/"));
  }
  return files.sort();
}

export function verifyManifestPackage({
  sourceDir,
  manifestFilename = "package-manifest.json",
  rejectUndeclared = false,
}) {
  const packageSourceDir = path.resolve(sourceDir);
  if (!fs.existsSync(packageSourceDir)) {
    throw new Error(`Source directory "${packageSourceDir}" does not exist.`);
  }

  if (!isPathSafe(packageSourceDir, manifestFilename)) {
    throw new Error(`Security Error: Unsafe manifest filename "${manifestFilename}".`);
  }
  const manifestPath = path.resolve(packageSourceDir, manifestFilename);
  if (!fs.existsSync(manifestPath)) throw new Error(`Manifest "${manifestPath}" not found.`);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse manifest at "${manifestPath}": ${error.message}`);
  }

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`Invalid manifest at "${manifestPath}": missing or empty "files" array.`);
  }

  const declared = new Set();
  for (const file of manifest.files) {
    if (!file || !isPathSafe(packageSourceDir, file.path)) {
      throw new Error(`Security Error: Forbidden or traversal path in manifest: "${file?.path}".`);
    }
    if (declared.has(file.path)) throw new Error(`Duplicate manifest file path: "${file.path}".`);
    declared.add(file.path);

    const sourceFile = path.resolve(packageSourceDir, file.path);
    if (!fs.existsSync(sourceFile)) throw new Error(`Source file "${file.path}" missing from package.`);
    if (fs.lstatSync(sourceFile).isSymbolicLink()) {
      throw new Error(`Security Error: Symbolic links are forbidden in manifest packages: "${file.path}".`);
    }
    const bytes = fs.readFileSync(sourceFile);
    if (bytes.length !== file.byteLength) {
      throw new Error(
        `Byte length mismatch for "${file.path}": expected ${file.byteLength}, got ${bytes.length}.`
      );
    }
    const hash = sha256File(sourceFile);
    if (hash !== file.sha256) {
      throw new Error(`SHA-256 mismatch for "${file.path}": expected ${file.sha256}, got ${hash}.`);
    }
  }

  if (rejectUndeclared) {
    const allowed = new Set([...declared, manifestFilename.replace(/\\/g, "/")]);
    for (const diskFile of getAllRelativeFiles(packageSourceDir)) {
      if (!allowed.has(diskFile)) throw new Error(`Undeclared source package file: "${diskFile}".`);
    }
  }

  return { manifest, manifestPath, sourceDir: packageSourceDir };
}

function siblingTemporaryPath(targetPath, marker) {
  const parent = path.dirname(targetPath);
  const base = path.basename(targetPath);
  return path.resolve(
    parent,
    `.${base}.${marker}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

export function prepareManifestPackageReplacement({
  sourceDir,
  destDir,
  manifestFilename = "package-manifest.json",
  allowedDestinationRoot,
  rejectUndeclared = false,
}) {
  const targetPath = path.resolve(destDir);
  assertDestinationAllowed(targetPath, allowedDestinationRoot);
  const verified = verifyManifestPackage({ sourceDir, manifestFilename, rejectUndeclared });

  const stagingPath = siblingTemporaryPath(targetPath, "tmp");
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.mkdirSync(stagingPath, { recursive: true });

  try {
    for (const file of verified.manifest.files) {
      const sourceFile = path.resolve(verified.sourceDir, file.path);
      const stagedFile = path.resolve(stagingPath, file.path);
      if (!isPathWithin(stagingPath, stagedFile, { allowBase: false })) {
        throw new Error(`Security Error: Staging path traversal: "${file.path}".`);
      }
      fs.mkdirSync(path.dirname(stagedFile), { recursive: true });
      fs.copyFileSync(sourceFile, stagedFile);
    }
    fs.copyFileSync(verified.manifestPath, path.resolve(stagingPath, manifestFilename));
    verifyManifestPackage({
      sourceDir: stagingPath,
      manifestFilename,
      rejectUndeclared: true,
    });
  } catch (error) {
    if (fs.existsSync(stagingPath)) fs.rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }

  return {
    kind: "directory",
    targetPath,
    stagingPath,
    backupPath: null,
    activated: false,
    manifest: verified.manifest,
  };
}

export function prepareFileReplacement({
  destFile,
  content,
  allowedDestinationRoot,
}) {
  const targetPath = path.resolve(destFile);
  assertDestinationAllowed(targetPath, allowedDestinationRoot);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const stagingPath = siblingTemporaryPath(targetPath, "tmp");
  const descriptor = fs.openSync(stagingPath, "wx");
  try {
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return {
    kind: "file",
    targetPath,
    stagingPath,
    backupPath: null,
    activated: false,
  };
}

function removePath(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  const stats = fs.statSync(targetPath);
  if (stats.isDirectory()) fs.rmSync(targetPath, { recursive: true, force: true });
  else fs.rmSync(targetPath, { force: true });
}

function clearDirectoryContents(directoryPath) {
  if (!fs.existsSync(directoryPath)) return;
  for (const entry of fs.readdirSync(directoryPath)) {
    removePath(path.join(directoryPath, entry));
  }
}

function copyDirectoryContents(sourcePath, destinationPath) {
  fs.mkdirSync(destinationPath, { recursive: true });
  for (const entry of fs.readdirSync(sourcePath)) {
    fs.cpSync(path.join(sourcePath, entry), path.join(destinationPath, entry), {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
  }
}

function isWindowsDirectoryRenameLock(error, replacement) {
  return (
    process.platform === "win32" &&
    replacement.kind === "directory" &&
    (error?.code === "EPERM" || error?.code === "EACCES")
  );
}

function activateLockedDirectoryInPlace(replacement) {
  // File watchers on Windows may keep a directory handle open and reject a
  // directory rename even though its files remain replaceable. Preserve the
  // verified package transaction by snapshotting the old contents first, then
  // replacing only entries inside the stable directory path.
  copyDirectoryContents(replacement.targetPath, replacement.backupPath);
  replacement.activationMode = "in-place";
  replacement.activated = true;
  clearDirectoryContents(replacement.targetPath);
  copyDirectoryContents(replacement.stagingPath, replacement.targetPath);
  removePath(replacement.stagingPath);
}

export function activatePreparedReplacements(replacements) {
  const targetKeys = new Set();
  for (const replacement of replacements) {
    const key = path.resolve(replacement.targetPath).toLowerCase();
    if (targetKeys.has(key)) throw new Error(`Duplicate transaction target: ${replacement.targetPath}`);
    targetKeys.add(key);
    if (!fs.existsSync(replacement.stagingPath)) {
      throw new Error(`Prepared staging path is missing: ${replacement.stagingPath}`);
    }
  }

  try {
    for (const replacement of replacements) {
      if (fs.existsSync(replacement.targetPath)) {
        replacement.backupPath = siblingTemporaryPath(replacement.targetPath, "bak");
        try {
          fs.renameSync(replacement.targetPath, replacement.backupPath);
        } catch (renameError) {
          if (!isWindowsDirectoryRenameLock(renameError, replacement)) throw renameError;
          activateLockedDirectoryInPlace(replacement);
          continue;
        }
      }
      fs.renameSync(replacement.stagingPath, replacement.targetPath);
      replacement.activationMode = "rename";
      replacement.activated = true;
    }
  } catch (activationError) {
    const rollbackErrors = [];
    for (const replacement of [...replacements].reverse()) {
      try {
        if (
          replacement.activated &&
          replacement.activationMode === "in-place" &&
          replacement.backupPath &&
          fs.existsSync(replacement.backupPath)
        ) {
          clearDirectoryContents(replacement.targetPath);
          copyDirectoryContents(replacement.backupPath, replacement.targetPath);
          removePath(replacement.backupPath);
        } else if (replacement.activated && fs.existsSync(replacement.targetPath)) {
          removePath(replacement.targetPath);
        }
        if (
          replacement.backupPath &&
          fs.existsSync(replacement.backupPath) &&
          !fs.existsSync(replacement.targetPath)
        ) {
          fs.renameSync(replacement.backupPath, replacement.targetPath);
        }
        if (fs.existsSync(replacement.stagingPath)) removePath(replacement.stagingPath);
      } catch (rollbackError) {
        rollbackErrors.push(`${replacement.targetPath}: ${rollbackError.message}`);
      }
    }
    const suffix = rollbackErrors.length ? ` Rollback errors: ${rollbackErrors.join("; ")}` : "";
    throw new Error(`Atomic transaction failed: ${activationError.message}.${suffix}`);
  }

  for (const replacement of replacements) {
    if (replacement.backupPath && fs.existsSync(replacement.backupPath)) {
      try {
        removePath(replacement.backupPath);
      } catch (cleanupError) {
        console.warn(
          `Warning: Could not remove temporary backup directory at "${replacement.backupPath}": ${cleanupError.message}`
        );
        console.warn("New destination remains active and fully functional.");
      }
    }
  }
}

export function cleanupPreparedReplacements(replacements) {
  for (const replacement of replacements) {
    if (replacement?.stagingPath && fs.existsSync(replacement.stagingPath)) {
      try {
        removePath(replacement.stagingPath);
      } catch {}
    }
  }
}

export function atomicSyncManifestPackage(options) {
  const replacement = prepareManifestPackageReplacement(options);
  activatePreparedReplacements([replacement]);
  return replacement.manifest;
}
