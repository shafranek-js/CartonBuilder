import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { verifyVendoredPlugins } from "../../../scripts/verify-vendored-plugins.mjs";
import { syncPbdPlugin } from "../../../scripts/sync-pbd-plugin.mjs";
import { syncViewerPlugin } from "../../../scripts/sync-viewer-plugin.mjs";
import { findForbiddenNetworkReferences } from "../../../scripts/lib/offlinePolicy.mjs";
import {
  activatePreparedReplacements,
  isPathSafe,
  prepareFileReplacement,
  prepareManifestPackageReplacement,
  sha256File,
  atomicSyncManifestPackage,
} from "../../../scripts/lib/atomicManifestSync.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");
const CSP = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const silentLogger = { log() {}, error() {}, warn() {} };

function integrity(filepath) {
  return { byteLength: fs.statSync(filepath).size, sha256: sha256File(filepath) };
}

function writeJson(filepath, value) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function createHostRoot(tempDir) {
  const hostRoot = path.join(tempDir, "host");
  fs.mkdirSync(path.join(hostRoot, "schemas"), { recursive: true });
  for (const schema of ["plugin.manifest.v1.schema.json", "plugins.manifest.v1.schema.json"]) {
    fs.copyFileSync(path.join(repoRoot, "schemas", schema), path.join(hostRoot, "schemas", schema));
  }
  fs.mkdirSync(path.join(hostRoot, "vendor/plugins"), { recursive: true });
  fs.mkdirSync(path.join(hostRoot, "src/workflow"), { recursive: true });
  fs.writeFileSync(path.join(hostRoot, "src/workflow/original.txt"), "original workflow", "utf8");
  return hostRoot;
}

function createPluginPackage(tempDir, { version = "1.2.0", htmlSuffix = "" } = {}) {
  const pluginDir = path.join(tempDir, "plugin-source");
  const contractDir = path.join(pluginDir, "contract");
  fs.mkdirSync(contractDir, { recursive: true });

  const html =
    `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${CSP}"></head><body>PBD${htmlSuffix}</body></html>\n`;
  fs.writeFileSync(path.join(pluginDir, "index.html"), html, "utf8");
  fs.writeFileSync(path.join(contractDir, "payload.js"), "export const value = 1;\n", "utf8");

  const sourceCommit = "a".repeat(40);
  const contractManifest = {
    packageName: "@cartonbuilder/workflow-v1",
    packageVersion: "1.0.0",
    contractVersion: "carton-workflow.v1",
    pbdCommit: sourceCommit,
    files: [{ path: "payload.js", ...integrity(path.join(contractDir, "payload.js")) }],
  };
  writeJson(path.join(contractDir, "package-manifest.json"), contractManifest);

  const manifest = {
    manifestVersion: "plugin.manifest.v1",
    id: "packaging-box-designer",
    version,
    name: "Packaging Box Designer",
    description: "PBD Plugin",
    entrypoint: "index.html",
    sourceCommit,
    artifact: integrity(path.join(pluginDir, "index.html")),
    contracts: {
      workflow: "carton-workflow.v1",
      modelSchema: "pbd.model.v1",
      svgSchema: "pbd.svg.v4",
    },
    capabilities: {
      artwork2d: true,
      flatExport: true,
      foldPreview: true,
      technicalRender: false,
    },
    referenceOnly: true,
    productionCertified: false,
    runtime: {
      sandboxing: ["allow-scripts"],
      csp: CSP,
      noExternalNetwork: true,
    },
    files: [
      { path: "contract/package-manifest.json", ...integrity(path.join(contractDir, "package-manifest.json")) },
      { path: "contract/payload.js", ...integrity(path.join(contractDir, "payload.js")) },
      { path: "index.html", ...integrity(path.join(pluginDir, "index.html")) },
    ],
  };
  writeJson(path.join(pluginDir, "plugin-manifest.json"), manifest);
  return { pluginDir, manifest, sourceCommit };
}

function createViewerPluginPackage(tempDir, { version = "2.4.0", htmlSuffix = "" } = {}) {
  const pluginDir = path.join(tempDir, "viewer-source");
  const runtimeDir = path.join(pluginDir, "runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });

  const html =
    `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${CSP}"></head><body>Viewer${htmlSuffix}</body></html>\n`;
  fs.writeFileSync(path.join(pluginDir, "index.html"), html, "utf8");
  fs.writeFileSync(path.join(runtimeDir, "runtime.js"), "export const runtime = true;\n", "utf8");

  const sourceCommit = "b".repeat(40);
  const runtimeManifest = {
    packageName: "@cartonbuilder/fold-runtime",
    packageVersion: version,
    viewerCommit: sourceCommit,
    files: [{ path: "runtime.js", ...integrity(path.join(runtimeDir, "runtime.js")) }],
  };
  writeJson(path.join(runtimeDir, "package-manifest.json"), runtimeManifest);

  const manifest = {
    manifestVersion: "plugin.manifest.v1",
    id: "carton-fold-viewer",
    version,
    name: "CartonFoldViewer",
    description: "Viewer Plugin",
    entrypoint: "index.html",
    sourceCommit,
    artifact: integrity(path.join(pluginDir, "index.html")),
    contracts: {
      workflow: "carton-workflow.v1",
      modelSchema: "pbd.model.v1",
      svgSchema: "pbd.svg.v4",
    },
    capabilities: {
      artwork2d: false,
      flatExport: false,
      foldPreview: true,
      technicalRender: false,
    },
    referenceOnly: true,
    productionCertified: false,
    runtime: {
      sandboxing: ["allow-scripts"],
      csp: CSP,
      noExternalNetwork: true,
    },
    files: [
      { path: "index.html", ...integrity(path.join(pluginDir, "index.html")) },
      { path: "runtime/package-manifest.json", ...integrity(path.join(runtimeDir, "package-manifest.json")) },
      { path: "runtime/runtime.js", ...integrity(path.join(runtimeDir, "runtime.js")) },
    ],
  };
  writeJson(path.join(pluginDir, "plugin-manifest.json"), manifest);
  return { pluginDir, manifest, sourceCommit };
}

describe("Vendored plugins verification gate", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-plugins-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("verifies the live vendored plugins catalog", () => {
    const result = verifyVendoredPlugins({ logger: silentLogger });
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.catalog.plugins.length).toBe(2);
  });

  it("rejects plugin version traversal before any destination mutation", () => {
    const hostRoot = createHostRoot(tempDir);
    const outside = path.join(tempDir, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "sentinel.txt"), "untouched", "utf8");

    const { pluginDir } = createPluginPackage(tempDir, { version: "../../outside" });
    expect(() => syncPbdPlugin(pluginDir, { rootDir: hostRoot })).toThrow(
      /Standalone plugin manifest validation failed/
    );
    expect(fs.readFileSync(path.join(outside, "sentinel.txt"), "utf8")).toBe("untouched");
    expect(fs.readdirSync(path.join(hostRoot, "vendor/plugins"))).toEqual([]);
    expect(fs.readFileSync(path.join(hostRoot, "src/workflow/original.txt"), "utf8")).toBe(
      "original workflow"
    );
  });

  it("rolls back plugin, workflow and catalog when the final activation fails", () => {
    const hostRoot = createHostRoot(tempDir);
    const { pluginDir } = createPluginPackage(tempDir);
    const originalRename = fs.renameSync.bind(fs);
    let renameCalls = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      renameCalls++;
      if (String(target).endsWith("plugins.manifest.json")) {
        throw new Error("simulated catalog activation failure");
      }
      return originalRename(source, target);
    });

    expect(() => syncPbdPlugin(pluginDir, { rootDir: hostRoot })).toThrow(
      /simulated catalog activation failure/
    );
    expect(
      fs.existsSync(
        path.join(hostRoot, "vendor/plugins/packaging-box-designer/1.2.0")
      )
    ).toBe(false);
    expect(fs.existsSync(path.join(hostRoot, "vendor/plugins/plugins.manifest.json"))).toBe(false);
    expect(fs.readFileSync(path.join(hostRoot, "src/workflow/original.txt"), "utf8")).toBe(
      "original workflow"
    );
    expect(renameCalls).toBeGreaterThan(3);
  }, 30_000);

  it("detects a modified standalone manifest even when plugin files are unchanged", () => {
    const hostRoot = createHostRoot(tempDir);
    const { pluginDir } = createPluginPackage(tempDir);
    syncPbdPlugin(pluginDir, { rootDir: hostRoot });
    const vendoredManifest = path.join(
      hostRoot,
      "vendor/plugins/packaging-box-designer/1.2.0/plugin-manifest.json"
    );
    const manifest = JSON.parse(fs.readFileSync(vendoredManifest, "utf8"));
    manifest.description = "tampered";
    writeJson(vendoredManifest, manifest);

    const result = verifyVendoredPlugins({ rootDir: hostRoot, logger: silentLogger });
    expect(result.valid).toBe(false);
    expect(result.issues.join("\n")).toMatch(/Catalog entry does not match/);
  });

  it("detects artifact-to-entrypoint disagreement in the catalog", () => {
    const hostRoot = createHostRoot(tempDir);
    const { pluginDir } = createPluginPackage(tempDir);
    syncPbdPlugin(pluginDir, { rootDir: hostRoot });
    const catalogPath = path.join(hostRoot, "vendor/plugins/plugins.manifest.json");
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    catalog.plugins[0].plugin.artifact.sha256 = "f".repeat(64);
    writeJson(catalogPath, catalog);

    const result = verifyVendoredPlugins({ rootDir: hostRoot, logger: silentLogger });
    expect(result.valid).toBe(false);
    expect(result.issues.join("\n")).toMatch(/Catalog entry does not match/);
  });

  it("rejects duplicate plugin identities in the catalog", () => {
    const hostRoot = createHostRoot(tempDir);
    const { pluginDir } = createPluginPackage(tempDir);
    syncPbdPlugin(pluginDir, { rootDir: hostRoot });
    const catalogPath = path.join(hostRoot, "vendor/plugins/plugins.manifest.json");
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    catalog.plugins.push(structuredClone(catalog.plugins[0]));
    writeJson(catalogPath, catalog);

    const result = verifyVendoredPlugins({ rootDir: hostRoot, logger: silentLogger });
    expect(result.valid).toBe(false);
    expect(result.issues.join("\n")).toMatch(/Duplicate plugin identity/);
  });

  it("rejects unauthorized files in the vendor plugins root", () => {
    const hostRoot = createHostRoot(tempDir);
    const { pluginDir } = createPluginPackage(tempDir);
    syncPbdPlugin(pluginDir, { rootDir: hostRoot });
    fs.writeFileSync(path.join(hostRoot, "vendor/plugins/unauthorized.txt"), "bad", "utf8");

    const result = verifyVendoredPlugins({ rootDir: hostRoot, logger: silentLogger });
    expect(result.valid).toBe(false);
    expect(result.issues.join("\n")).toMatch(/Unauthorized file/);
  });

  it("rejects a namespace-line bypass and other external URL forms", () => {
    const findings = findForbiddenNetworkReferences(
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/a.png"/></svg>\n' +
        "const ws = 'wss://evil.example/socket';\n" +
        "<script src='//evil.example/a.js'></script>\n" +
        "const url = \"//evil.example/data\";\n" +
        "body { background: url(//evil.example/bg.png); }"
    );
    expect(findings.map((finding) => finding.reference)).toEqual([
      "https://evil.example/a.png",
      "wss://evil.example/socket",
      "//evil.example/a.js",
      "//evil.example/data",
      "//evil.example/bg.png",
    ]);
    expect(
      findForbiddenNetworkReferences('<svg xmlns="http://www.w3.org/2000/svg"/>')
    ).toEqual([]);
    expect(
      findForbiddenNetworkReferences('http://www.w3.org/2000/svg.evil.example/a.js')
    ).toHaveLength(1);
    expect(
      findForbiddenNetworkReferences('https&colon;&sol;&sol;evil.example/a.js')
    ).toHaveLength(1);
    expect(
      findForbiddenNetworkReferences('&sol;&sol;evil.example/a.js')
    ).toHaveLength(1);
    expect(
      findForbiddenNetworkReferences('<script src=//evil.example/a.js></script>')
    ).toHaveLength(1);
    expect(
      findForbiddenNetworkReferences('<img src=//evil.example/a.png>')
    ).toHaveLength(1);
    expect(
      findForbiddenNetworkReferences('<link href=//evil.example/a.css>')
    ).toHaveLength(1);
    expect(
      findForbiddenNetworkReferences('<iframe src=//evil.example/embed></iframe>')
    ).toHaveLength(1);
    expect(
      findForbiddenNetworkReferences('<form action=//evil.example/submit></form>')
    ).toHaveLength(1);
  });

  it("rejects an external reference during sync preflight without mutation", () => {
    const hostRoot = createHostRoot(tempDir);
    const { pluginDir } = createPluginPackage(tempDir, {
      htmlSuffix: '<img src="https://evil.example/pixel.png">',
    });
    expect(() => syncPbdPlugin(pluginDir, { rootDir: hostRoot })).toThrow(
      /Forbidden external network reference/
    );
    expect(fs.readdirSync(path.join(hostRoot, "vendor/plugins"))).toEqual([]);
  });

  it("syncs and verifies both PBD and Viewer plugins transactionally", { timeout: 20_000 }, () => {
    const hostRoot = createHostRoot(tempDir);
    const { pluginDir: pbdDir } = createPluginPackage(tempDir);
    const { pluginDir: viewerDir } = createViewerPluginPackage(tempDir);

    syncPbdPlugin(pbdDir, { rootDir: hostRoot });
    syncViewerPlugin(viewerDir, { rootDir: hostRoot });

    const result = verifyVendoredPlugins({ rootDir: hostRoot, logger: silentLogger });
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.catalog.plugins.length).toBe(2);
    expect(result.catalog.plugins.map((p) => p.plugin.id)).toEqual(["carton-fold-viewer", "packaging-box-designer"]);
  });

  it("detects a modified standalone manifest in Viewer plugin", () => {
    const hostRoot = createHostRoot(tempDir);
    const { pluginDir: viewerDir } = createViewerPluginPackage(tempDir);
    syncViewerPlugin(viewerDir, { rootDir: hostRoot });
    const vendoredManifest = path.join(
      hostRoot,
      "vendor/plugins/carton-fold-viewer/2.4.0/plugin-manifest.json"
    );
    const manifest = JSON.parse(fs.readFileSync(vendoredManifest, "utf8"));
    manifest.description = "tampered-viewer";
    writeJson(vendoredManifest, manifest);

    const result = verifyVendoredPlugins({ rootDir: hostRoot, logger: silentLogger });
    expect(result.valid).toBe(false);
    expect(result.issues.join("\n")).toMatch(/Catalog entry does not match/);
  });

  it("rejects Viewer plugin version traversal and invalid id", () => {
    const hostRoot = createHostRoot(tempDir);
    const { pluginDir: badVersionDir } = createViewerPluginPackage(tempDir, { version: "../../bad" });
    expect(() => syncViewerPlugin(badVersionDir, { rootDir: hostRoot })).toThrow(
      /Standalone plugin manifest validation failed/
    );

    const { pluginDir: badIdDir, manifest } = createViewerPluginPackage(tempDir, { version: "2.4.0" });
    manifest.id = "malicious-plugin";
    writeJson(path.join(badIdDir, "plugin-manifest.json"), manifest);
    expect(() => syncViewerPlugin(badIdDir, { rootDir: hostRoot })).toThrow(
      /Invalid plugin ID: expected "carton-fold-viewer"/
    );
  });

  it("strictly validates isPathSafe", () => {
    const base = path.resolve(os.tmpdir(), "safe-test");
    expect(isPathSafe(base, "file.txt")).toBe(true);
    expect(isPathSafe(base, "sub/dir/file.txt")).toBe(true);
    expect(isPathSafe(base, "../outside.txt")).toBe(false);
    expect(isPathSafe(base, "..\\outside.txt")).toBe(false);
    expect(isPathSafe(base, "/absolute/path.txt")).toBe(false);
    expect(isPathSafe(base, "C:\\Windows\\system32")).toBe(false);
  });
});

describe("Atomic manifest package replacement", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-atomic-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createAtomicFixture({ badPath = false, badHash = false } = {}) {
    const sourceDir = path.join(tempDir, "source");
    const destination = path.join(tempDir, "destination");
    fs.mkdirSync(sourceDir);
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, "original.txt"), "original", "utf8");
    fs.writeFileSync(path.join(sourceDir, "payload.txt"), "payload", "utf8");
    const manifest = {
      manifestVersion: "test.manifest.v1",
      files: [
        {
          path: badPath ? "../../../outside.txt" : "payload.txt",
          byteLength: 7,
          sha256: badHash ? "f".repeat(64) : sha256File(path.join(sourceDir, "payload.txt")),
        },
      ],
    };
    writeJson(path.join(sourceDir, "package-manifest.json"), manifest);
    return { sourceDir, destination };
  }

  it("preserves destination on traversal and hash failures", () => {
    for (const options of [{ badPath: true }, { badHash: true }]) {
      const fixtureRoot = fs.mkdtempSync(path.join(tempDir, "case-"));
      const originalTemp = tempDir;
      tempDir = fixtureRoot;
      const { sourceDir, destination } = createAtomicFixture(options);
      expect(() =>
        atomicSyncManifestPackage({ sourceDir, destDir: destination })
      ).toThrow();
      expect(fs.readFileSync(path.join(destination, "original.txt"), "utf8")).toBe("original");
      tempDir = originalTemp;
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("replaces a valid package atomically", () => {
    const { sourceDir, destination } = createAtomicFixture();
    const manifest = atomicSyncManifestPackage({ sourceDir, destDir: destination });
    expect(manifest.manifestVersion).toBe("test.manifest.v1");
    expect(fs.readFileSync(path.join(destination, "payload.txt"), "utf8")).toBe("payload");
    expect(fs.existsSync(path.join(destination, "original.txt"))).toBe(false);
  });

  it.runIf(process.platform === "win32")(
    "replaces a valid package when a Windows watcher blocks the destination directory rename",
    () => {
      const { sourceDir, destination } = createAtomicFixture();
      const originalRename = fs.renameSync.bind(fs);
      vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
        if (path.resolve(source) === path.resolve(destination) && String(target).includes(".bak-")) {
          const error = new Error("simulated Windows directory watcher lock");
          error.code = "EPERM";
          throw error;
        }
        return originalRename(source, target);
      });

      const manifest = atomicSyncManifestPackage({ sourceDir, destDir: destination });
      expect(manifest.manifestVersion).toBe("test.manifest.v1");
      expect(fs.readFileSync(path.join(destination, "payload.txt"), "utf8")).toBe("payload");
      expect(fs.existsSync(path.join(destination, "original.txt"))).toBe(false);
      expect(
        fs.readdirSync(path.dirname(destination)).some((entry) => entry.includes(".bak-"))
      ).toBe(false);
    }
  );

  it.runIf(process.platform === "win32")(
    "rolls back the Windows locked-directory fallback when a later activation fails",
    () => {
      const { sourceDir, destination } = createAtomicFixture();
      const catalogPath = path.join(tempDir, "catalog.json");
      fs.writeFileSync(catalogPath, "old catalog", "utf8");
      const directoryReplacement = prepareManifestPackageReplacement({
        sourceDir,
        destDir: destination,
      });
      const fileReplacement = prepareFileReplacement({
        destFile: catalogPath,
        content: Buffer.from("new catalog", "utf8"),
      });
      const originalRename = fs.renameSync.bind(fs);
      vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
        if (path.resolve(source) === path.resolve(destination) && String(target).includes(".bak-")) {
          const error = new Error("simulated Windows directory watcher lock");
          error.code = "EPERM";
          throw error;
        }
        if (
          path.resolve(source) === path.resolve(fileReplacement.stagingPath) &&
          path.resolve(target) === path.resolve(catalogPath)
        ) {
          throw new Error("simulated catalog activation failure after in-place package replacement");
        }
        return originalRename(source, target);
      });

      expect(() =>
        activatePreparedReplacements([directoryReplacement, fileReplacement])
      ).toThrow(/simulated catalog activation failure/);
      expect(fs.readFileSync(path.join(destination, "original.txt"), "utf8")).toBe("original");
      expect(fs.existsSync(path.join(destination, "payload.txt"))).toBe(false);
      expect(fs.readFileSync(catalogPath, "utf8")).toBe("old catalog");
    }
  );
});
