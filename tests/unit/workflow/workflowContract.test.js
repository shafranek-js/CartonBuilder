import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import {
  validateCartonWorkflowBundle,
  CONTRACT_VERSION,
  WORKFLOW_MODE,
  ALLOWED_CARTON_TYPES,
  scanSvgSecurity,
  sha256Async,
  utf8ByteLength,
  validateModelExport,
  validateSvgV4Export,
} from "../../../src/workflow/index.js";
import { isPathSafe, syncWorkflowContract } from "../../../scripts/sync-workflow-contract.mjs";

const fixturesDir = path.resolve("src/workflow/fixtures");
const workflowPackageDir = path.resolve("src/workflow");

function loadFixture(filename) {
  const filepath = path.join(fixturesDir, filename);
  return JSON.parse(fs.readFileSync(filepath, "utf8"));
}

function sha256Bytes(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function createValidSyncPackage() {
  const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), "carton-workflow-package-"));
  const payload = Buffer.from("new contract payload", "utf8");
  fs.writeFileSync(path.join(packageDir, "payload.txt"), payload);
  fs.writeFileSync(
    path.join(packageDir, "package-manifest.json"),
    JSON.stringify({
      packageName: "@cartonbuilder/workflow-v1",
      packageVersion: "1.0.0",
      contractVersion: "carton-workflow.v1",
      pbdCommit: "test-commit",
      files: [{ path: "payload.txt", byteLength: payload.length, sha256: sha256Bytes(payload) }],
    }),
    "utf8"
  );
  return packageDir;
}

function createExistingSyncDestination() {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "carton-workflow-destination-"));
  const destination = path.join(testRoot, "workflow");
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, "original-marker.txt"), "original", "utf8");
  return { testRoot, destination };
}

describe("carton-workflow.v1 package manifest and byte-for-byte integrity", () => {
  it("verifies that all committed package files match the manifest hashes byte-for-byte", () => {
    const manifestPath = path.join(workflowPackageDir, "package-manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.packageName).toBe("@cartonbuilder/workflow-v1");
    expect(manifest.packageVersion).toBe("1.0.0");
    expect(manifest.contractVersion).toBe("carton-workflow.v1");
    expect(typeof manifest.pbdCommit).toBe("string");
    expect(manifest.pbdCommit.length).toBeGreaterThan(0);
    expect(Array.isArray(manifest.files)).toBe(true);
    expect(manifest.files.length).toBeGreaterThanOrEqual(15);

    for (const entry of manifest.files) {
      const fullPath = path.join(workflowPackageDir, entry.path);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath);
      const actualSha = sha256Bytes(content);
      expect(content.length).toBe(entry.byteLength);
      expect(actualSha).toBe(entry.sha256);
    }
  });
});

describe("carton-workflow.v1 schema and golden fixtures", () => {
  const cases = [
    ["RTE", "rte-workflow.v1.json"],
    ["STE", "ste-workflow.v1.json"],
    ["TT_SL123", "tt_sl123-workflow.v1.json"],
  ];

  it.each(cases)("passes complete validation for %s golden fixture", async (_name, filename) => {
    const bundle = loadFixture(filename);
    const result = await validateCartonWorkflowBundle(bundle);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.issues).toEqual([]);

    expect(bundle.contractVersion).toBe(CONTRACT_VERSION);
    expect(bundle.workflowMode).toBe(WORKFLOW_MODE);
    expect(ALLOWED_CARTON_TYPES).toContain(bundle.source.cartonType);
    expect(bundle.source.producer).toBe("packaging-box-designer");
    expect(typeof bundle.source.artifactSha256).toBe("string");
    expect(bundle.source.artifactSha256).toHaveLength(64);

    // Asset ID is content-addressed on SVG SHA-256
    expect(typeof bundle.semanticSvg.assetId).toBe("string");
    expect(bundle.semanticSvg.assetId).toMatch(/^svg-[a-f0-9]{16}$/);

    // ProfileIds must be an array of strings
    expect(Array.isArray(bundle.source.profileIds)).toBe(true);
    expect(bundle.source.profileIds.every((id) => typeof id === "string")).toBe(true);

    if (bundle.source.cartonType === "TT_SL123") {
      expect(bundle.source.profileIds).toContain("ecma-a55.20.01.03-v0.2");
    }

    // Direct parity with PBD canonical model and SVG validators
    const parsedModel = JSON.parse(bundle.modelJson.text);
    const modelPbdValid = validateModelExport(parsedModel);
    expect(modelPbdValid.valid).toBe(true);

    const svgPbdValid = validateSvgV4Export(bundle.semanticSvg.markup);
    expect(svgPbdValid.valid).toBe(true);

    // Web Crypto SHA-256 and byteLength verification
    expect(await sha256Async(bundle.modelJson.text)).toBe(bundle.modelJson.sha256);
    expect(utf8ByteLength(bundle.modelJson.text)).toBe(bundle.modelJson.byteLength);

    expect(await sha256Async(bundle.semanticSvg.markup)).toBe(bundle.semanticSvg.sha256);
    expect(utf8ByteLength(bundle.semanticSvg.markup)).toBe(bundle.semanticSvg.byteLength);

    // Capabilities semantics: technicalRender is false until Stage 3
    expect(bundle.capabilities.technicalRender).toBe(false);
  });
});

describe("preflight payload size limits and short-circuit behavior", () => {
  it("rejects oversized Model JSON and short-circuits without attempting JSON parse", async () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    const result = await validateCartonWorkflowBundle(bundle, { maxModelBytes: 1000 });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "MODEL_OVERSIZED")).toBe(true);
    expect(result.issues.some((i) => i.code === "MODEL_JSON_SYNTAX_ERROR")).toBe(false);
  });

  it("rejects oversized SVG and short-circuits without attempting XML parse", async () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    const result = await validateCartonWorkflowBundle(bundle, { maxSvgBytes: 1000 });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "SVG_OVERSIZED")).toBe(true);
  });
});

describe("XML/SVG security preflight and entity decoding", () => {
  it("detects XML declaration followed by forbidden <?xml-stylesheet and does NOT call DOMParser", () => {
    const svg = `<?xml version="1.0"?>
<?xml-stylesheet type="text/xsl" href="https://evil.example/x.xsl"?>
<svg xmlns="http://www.w3.org/2000/svg"></svg>`;
    let parserCalled = false;
    const issues = scanSvgSecurity(svg, { onParserCalled: () => { parserCalled = true; } });
    expect(issues.some((i) => i.code === "SVG_SECURITY_PROCESSING_INSTRUCTION_FORBIDDEN")).toBe(true);
    expect(parserCalled).toBe(false);
  });

  it("detects <!DOCTYPE and does NOT call DOMParser", () => {
    const svg = '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"></svg>';
    let parserCalled = false;
    const issues = scanSvgSecurity(svg, { onParserCalled: () => { parserCalled = true; } });
    expect(issues.some((i) => i.code === "SVG_SECURITY_DOCTYPE_FORBIDDEN")).toBe(true);
    expect(parserCalled).toBe(false);
  });

  it("detects entity-encoded javascript: URI schemes", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" data-export-schema-version="pbd.svg.v4"><rect href="java&#x73;cript:alert(1)" /></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_JAVASCRIPT_URI_FORBIDDEN")).toBe(true);
  });

  it("detects entity-encoded https: external links in href", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" data-export-schema-version="pbd.svg.v4"><rect href="https&#x3a;//example.com/leak.png" /></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_EXTERNAL_LINK_FORBIDDEN")).toBe(true);
  });

  it("detects entity-encoded external url(...) in style attributes", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" data-export-schema-version="pbd.svg.v4"><rect style="fill:url(https&#x3a;//evil.example/x.svg)"/></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_EXTERNAL_LINK_FORBIDDEN")).toBe(true);
  });

  it("detects <script> tags", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" data-export-schema-version="pbd.svg.v4"><script>alert(1)</script></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_ELEMENT_FORBIDDEN")).toBe(true);
  });

  it("detects <foreignObject> tags", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" data-export-schema-version="pbd.svg.v4"><foreignObject><div>test</div></foreignObject></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_ELEMENT_FORBIDDEN")).toBe(true);
  });

  it("detects inline event handlers", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" data-export-schema-version="pbd.svg.v4"><rect onload="alert(1)" /></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_EVENT_HANDLER_FORBIDDEN")).toBe(true);
  });

  it("detects @import in style blocks", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" data-export-schema-version="pbd.svg.v4"><style>@import "https://evil.com";</style></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_STYLE_IMPORT_FORBIDDEN")).toBe(true);
  });

  it("detects malformed XML (duplicate attributes)", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" x="10" /></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_XML_SYNTAX_ERROR")).toBe(true);
  });

  it("detects malformed XML (undeclared namespace prefix)", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect xlink:href="#a" /></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_XML_SYNTAX_ERROR")).toBe(true);
  });

  it("detects malformed XML (unknown XML entity)", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect id="&unknownEntity;" /></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_XML_SYNTAX_ERROR")).toBe(true);
  });
});

describe("strict Ajv 2020 schema enforcement and additionalProperties: false", () => {
  it("rejects bundle with forbidden source.unexpected property", async () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    bundle.source.unexpected = "payload";
    const res = await validateCartonWorkflowBundle(bundle);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "SCHEMA_ADDITIONAL_PROPERTY_FORBIDDEN")).toBe(true);
  });

  it("rejects bundle with untrusted producer", async () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    bundle.source.producer = "untrusted-producer";
    const res = await validateCartonWorkflowBundle(bundle);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "SCHEMA_PRODUCER_INVALID")).toBe(true);
  });

  it("rejects bundle with root-level unexpected property", async () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    bundle.rootUnexpected = 123;
    const res = await validateCartonWorkflowBundle(bundle);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "SCHEMA_ADDITIONAL_PROPERTY_FORBIDDEN")).toBe(true);
  });

  it("validates expected host verification options", async () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    const resMismatch = await validateCartonWorkflowBundle(bundle, {
      expectedArtifactSha256: "0".repeat(64),
    });
    expect(resMismatch.valid).toBe(false);
    expect(resMismatch.issues.some((i) => i.code === "ARTIFACT_SHA256_MISMATCH")).toBe(true);
  });
});

describe("cyclic and malformed payloads safety", () => {
  it("safely rejects cyclic bundle without throwing exceptions", async () => {
    const cyclicBundle = loadFixture("rte-workflow.v1.json");
    cyclicBundle.self = cyclicBundle;
    const res = await validateCartonWorkflowBundle(cyclicBundle);
    expect(res.valid).toBe(false);
    expect(res.issues.length).toBeGreaterThan(0);
  });

  it("rejects non-object bundle", async () => {
    const res = await validateCartonWorkflowBundle(null);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "BUNDLE_NOT_OBJECT" || i.code === "SCHEMA_NOT_AN_OBJECT" || i.code === "SCHEMA_TYPE_MISMATCH")).toBe(true);
  });
});

describe("schema/runtime parity with PBD canonical validators", () => {
  it("identically rejects Model JSON missing visibleLayers", async () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    const modelObj = JSON.parse(bundle.modelJson.text);
    delete modelObj.exportMetadata.visibleLayers;

    const pbdResult = validateModelExport(modelObj);
    expect(pbdResult.valid).toBe(false);
    expect(pbdResult.issues.some((i) => i.code === "EXPORT_METADATA_STATE_INVALID")).toBe(true);

    bundle.modelJson.text = JSON.stringify(modelObj);
    bundle.modelJson.byteLength = utf8ByteLength(bundle.modelJson.text);
    bundle.modelJson.sha256 = await sha256Async(bundle.modelJson.text);

    const bundleResult = await validateCartonWorkflowBundle(bundle);
    expect(bundleResult.valid).toBe(false);
    expect(bundleResult.issues.some((i) => i.code === "EXPORT_METADATA_STATE_INVALID")).toBe(true);
  });

  it("identically rejects Model JSON missing validation.limits", async () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    const modelObj = JSON.parse(bundle.modelJson.text);
    delete modelObj.validation.limits;

    const pbdResult = validateModelExport(modelObj);
    expect(pbdResult.valid).toBe(false);
    expect(pbdResult.issues.some((i) => i.code === "EXPORT_VALIDATION_INVALID")).toBe(true);

    bundle.modelJson.text = JSON.stringify(modelObj);
    bundle.modelJson.byteLength = utf8ByteLength(bundle.modelJson.text);
    bundle.modelJson.sha256 = await sha256Async(bundle.modelJson.text);

    const bundleResult = await validateCartonWorkflowBundle(bundle);
    expect(bundleResult.valid).toBe(false);
    expect(bundleResult.issues.some((i) => i.code === "EXPORT_VALIDATION_INVALID")).toBe(true);
  });
});

describe("sync script path safety, security gates and atomic replacement", () => {
  it("isPathSafe helper correctly identifies valid relative paths and rejects traversals", () => {
    const base = path.resolve("dist/test-base");
    expect(isPathSafe(base, "file.txt")).toBe(true);
    expect(isPathSafe(base, "sub/dir/file.txt")).toBe(true);
    expect(isPathSafe(base, "../outside.txt")).toBe(false);
    expect(isPathSafe(base, "sub/../../outside.txt")).toBe(false);
    expect(isPathSafe(base, "/etc/passwd")).toBe(false);
    expect(isPathSafe(base, "C:\\Windows\\system32")).toBe(false);
  });

  it("rejects malicious package with path traversal in manifest before touching destination", () => {
    const testTempDir = path.resolve("tests/unit/workflow/.tmp-traversal-pkg");
    if (fs.existsSync(testTempDir)) fs.rmSync(testTempDir, { recursive: true, force: true });
    fs.mkdirSync(testTempDir, { recursive: true });

    const dummyFile = path.join(testTempDir, "valid.txt");
    fs.writeFileSync(dummyFile, "hello", "utf8");

    const maliciousManifest = {
      packageName: "@cartonbuilder/workflow-v1",
      packageVersion: "1.0.0",
      contractVersion: "carton-workflow.v1",
      pbdCommit: "mock-commit",
      files: [
        { path: "valid.txt", byteLength: 5, sha256: sha256Bytes(Buffer.from("hello")) },
        { path: "../../../malicious.txt", byteLength: 10, sha256: "0".repeat(64) },
      ],
    };
    fs.writeFileSync(path.join(testTempDir, "package-manifest.json"), JSON.stringify(maliciousManifest), "utf8");

    const manifestBefore = fs.readFileSync(path.join(workflowPackageDir, "package-manifest.json"), "utf8");

    expect(() => {
      execSync(`node scripts/sync-workflow-contract.mjs --source "${testTempDir}"`, {
        encoding: "utf8",
        stdio: "pipe",
      });
    }).toThrow();

    // Verify existing src/workflow was completely untouched
    const manifestAfter = fs.readFileSync(path.join(workflowPackageDir, "package-manifest.json"), "utf8");
    expect(manifestAfter).toBe(manifestBefore);

    fs.rmSync(testTempDir, { recursive: true, force: true });
  });

  it("rejects corrupted package with SHA-256 hash mismatch and preserves destination", () => {
    const testTempDir = path.resolve("tests/unit/workflow/.tmp-corrupted-pkg");
    if (fs.existsSync(testTempDir)) fs.rmSync(testTempDir, { recursive: true, force: true });
    fs.mkdirSync(testTempDir, { recursive: true });

    const dummyFile = path.join(testTempDir, "valid.txt");
    fs.writeFileSync(dummyFile, "hello corrupted", "utf8");

    const corruptedManifest = {
      packageName: "@cartonbuilder/workflow-v1",
      packageVersion: "1.0.0",
      contractVersion: "carton-workflow.v1",
      pbdCommit: "mock-commit",
      files: [
        { path: "valid.txt", byteLength: 15, sha256: "0".repeat(64) }, // Invalid SHA
      ],
    };
    fs.writeFileSync(path.join(testTempDir, "package-manifest.json"), JSON.stringify(corruptedManifest), "utf8");

    const manifestBefore = fs.readFileSync(path.join(workflowPackageDir, "package-manifest.json"), "utf8");

    expect(() => {
      execSync(`node scripts/sync-workflow-contract.mjs --source "${testTempDir}"`, {
        encoding: "utf8",
        stdio: "pipe",
      });
    }).toThrow();

    const manifestAfter = fs.readFileSync(path.join(workflowPackageDir, "package-manifest.json"), "utf8");
    expect(manifestAfter).toBe(manifestBefore);

    fs.rmSync(testTempDir, { recursive: true, force: true });
  }, 30_000);

  it("restores the original destination when staging activation fails", () => {
    const packageDir = createValidSyncPackage();
    const { testRoot, destination } = createExistingSyncDestination();
    const originalRenameSync = fs.renameSync.bind(fs);
    let renameCall = 0;
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      renameCall++;
      if (renameCall === 2) {
        throw new Error("simulated staging activation failure");
      }
      return originalRenameSync(source, target);
    });

    try {
      expect(() => syncWorkflowContract(packageDir, destination)).toThrow("simulated staging activation failure");
      expect(fs.readFileSync(path.join(destination, "original-marker.txt"), "utf8")).toBe("original");
      expect(fs.existsSync(path.join(destination, "payload.txt"))).toBe(false);
      expect(renameCall).toBe(3);
    } finally {
      renameSpy.mockRestore();
      fs.rmSync(packageDir, { recursive: true, force: true });
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("keeps the activated destination and reports a recoverable backup when cleanup fails", () => {
    const packageDir = createValidSyncPackage();
    const { testRoot, destination } = createExistingSyncDestination();
    const originalRmSync = fs.rmSync.bind(fs);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rmSpy = vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (path.basename(String(target)).startsWith(".workflow.bak-")) {
        throw new Error("simulated backup cleanup failure");
      }
      return originalRmSync(target, options);
    });

    let backupDir;
    try {
      const manifest = syncWorkflowContract(packageDir, destination);
      expect(manifest.pbdCommit).toBe("test-commit");
      expect(fs.readFileSync(path.join(destination, "payload.txt"), "utf8")).toBe("new contract payload");
      expect(fs.existsSync(path.join(destination, "original-marker.txt"))).toBe(false);

      backupDir = fs.readdirSync(testRoot, { withFileTypes: true })
        .find((entry) => entry.isDirectory() && entry.name.startsWith(".workflow.bak-"));
      expect(backupDir).toBeDefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(path.join(testRoot, backupDir.name)));
      expect(warnSpy).toHaveBeenCalledWith("New destination remains active and fully functional.");
      expect(fs.existsSync(path.join(testRoot, "src"))).toBe(false);
    } finally {
      rmSpy.mockRestore();
      warnSpy.mockRestore();
      fs.rmSync(packageDir, { recursive: true, force: true });
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });
});
