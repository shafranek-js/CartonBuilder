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
  isPathSafe,
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
      technicalRender: true,
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

  it("verifies the committed repository plugins catalog cleanly", () => {
    const result = verifyVendoredPlugins({ logger: silentLogger });
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.catalog.plugins.length).toBe(2);
  });

  it("syncs and verifies both PBD and Viewer plugins transactionally", () => {
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

  it("detects forbidden network references while ignoring comments", () => {
    const cleanWithComments = `
      // https://github.com/mrdoob/three.js/issues/123
      /* https://developer.mozilla.org/en-US/docs/Web/API */
      //uniforms.envMap.value
      const x = 42;
    `;
    expect(findForbiddenNetworkReferences(cleanWithComments)).toEqual([]);

    const realNetworkCall = `
      fetch("https://evil.example.com/api");
    `;
    const issues = findForbiddenNetworkReferences(realNetworkCall);
    expect(issues.length).toBe(1);
    expect(issues[0].reference).toBe("https://evil.example.com/api");
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
});
