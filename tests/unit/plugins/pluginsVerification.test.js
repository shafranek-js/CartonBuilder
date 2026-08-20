import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { verifyVendoredPlugins } from "../../../scripts/verify-vendored-plugins.mjs";
import {
  isPathSafe,
  sha256File,
  atomicSyncManifestPackage,
} from "../../../scripts/lib/atomicManifestSync.mjs";

describe("Vendored Plugins Integrity and Verification Gate", () => {
  it("verifies live vendored plugins catalog successfully", () => {
    const result = verifyVendoredPlugins();
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("strictly validates isPathSafe against traversal and absolute paths", () => {
    const base = path.resolve(os.tmpdir(), "safe-test");
    expect(isPathSafe(base, "file.txt")).toBe(true);
    expect(isPathSafe(base, "sub/dir/file.txt")).toBe(true);
    expect(isPathSafe(base, "../outside.txt")).toBe(false);
    expect(isPathSafe(base, "..\\outside.txt")).toBe(false);
    expect(isPathSafe(base, "sub/../../outside.txt")).toBe(false);
    expect(isPathSafe(base, "/absolute/path.txt")).toBe(false);
    expect(isPathSafe(base, "C:\\Windows\\system32")).toBe(false);
    expect(isPathSafe(base, "D:/other/drive")).toBe(false);
  });
});

describe("Atomic Manifest Sync and Fault Tolerance", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-atomic-test-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("aborts atomic sync when manifest contains path traversal and preserves destination", () => {
    const srcDir = path.join(tempDir, "src-pkg");
    const destDir = path.join(tempDir, "dest-pkg");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(destDir, { recursive: true });

    fs.writeFileSync(path.join(destDir, "original.txt"), "untouched destination", "utf8");

    const manifest = {
      manifestVersion: "plugins.manifest.v1",
      files: [
        {
          path: "../../../evil.txt",
          byteLength: 10,
          sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        },
      ],
    };
    fs.writeFileSync(path.join(srcDir, "plugin-manifest.json"), JSON.stringify(manifest), "utf8");

    expect(() =>
      atomicSyncManifestPackage({
        sourceDir: srcDir,
        destDir,
        manifestFilename: "plugin-manifest.json",
      })
    ).toThrow(/Security Error: Forbidden or traversal path/);

    // Destination remains untouched
    expect(fs.existsSync(path.join(destDir, "original.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(destDir, "original.txt"), "utf8")).toBe("untouched destination");
  });

  it("aborts atomic sync when file hash or byte length is corrupt and preserves destination", () => {
    const srcDir = path.join(tempDir, "src-pkg");
    const destDir = path.join(tempDir, "dest-pkg");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(destDir, { recursive: true });

    fs.writeFileSync(path.join(destDir, "original.txt"), "untouched destination", "utf8");
    const content = "<h1>Valid Content</h1>";
    fs.writeFileSync(path.join(srcDir, "index.html"), content, "utf8");

    const manifest = {
      manifestVersion: "plugins.manifest.v1",
      files: [
        {
          path: "index.html",
          byteLength: Buffer.byteLength(content, "utf8"),
          sha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", // Bad hash
        },
      ],
    };
    fs.writeFileSync(path.join(srcDir, "plugin-manifest.json"), JSON.stringify(manifest), "utf8");

    expect(() =>
      atomicSyncManifestPackage({
        sourceDir: srcDir,
        destDir,
        manifestFilename: "plugin-manifest.json",
      })
    ).toThrow(/SHA-256 mismatch/);

    // Destination remains untouched
    expect(fs.existsSync(path.join(destDir, "original.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(destDir, "original.txt"), "utf8")).toBe("untouched destination");
  });

  it("successfully performs atomic swap on valid package", () => {
    const srcDir = path.join(tempDir, "src-pkg");
    const destDir = path.join(tempDir, "dest-pkg");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(destDir, { recursive: true });

    fs.writeFileSync(path.join(destDir, "original.txt"), "old content", "utf8");

    const htmlContent = "<!DOCTYPE html><html><body>PBD Plugin</body></html>\n";
    fs.writeFileSync(path.join(srcDir, "index.html"), htmlContent, "utf8");

    const manifest = {
      manifestVersion: "plugins.manifest.v1",
      files: [
        {
          path: "index.html",
          byteLength: Buffer.byteLength(htmlContent, "utf8"),
          sha256: sha256File(path.join(srcDir, "index.html")),
        },
      ],
    };
    fs.writeFileSync(path.join(srcDir, "plugin-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    const synced = atomicSyncManifestPackage({
      sourceDir: srcDir,
      destDir,
      manifestFilename: "plugin-manifest.json",
    });

    expect(synced.manifestVersion).toBe("plugins.manifest.v1");
    expect(fs.existsSync(path.join(destDir, "index.html"))).toBe(true);
    expect(fs.readFileSync(path.join(destDir, "index.html"), "utf8")).toBe(htmlContent);
    expect(fs.existsSync(path.join(destDir, "original.txt"))).toBe(false);
  });
});
