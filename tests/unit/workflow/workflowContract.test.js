import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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

const fixturesDir = path.resolve("src/workflow/fixtures");
const workflowPackageDir = path.resolve("src/workflow");

function loadFixture(filename) {
  const filepath = path.join(fixturesDir, filename);
  return JSON.parse(fs.readFileSync(filepath, "utf8"));
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
      const actualSha = crypto.createHash("sha256").update(content).digest("hex");
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
  it("detects entity-encoded javascript: URI schemes", () => {
    const svg = '<svg data-export-schema-version="pbd.svg.v4"><rect href="java&#x73;cript:alert(1)" /></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_JAVASCRIPT_URI_FORBIDDEN")).toBe(true);
  });

  it("detects entity-encoded https: external links in href", () => {
    const svg = '<svg data-export-schema-version="pbd.svg.v4"><rect href="https&#x3a;//example.com/leak.png" /></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_EXTERNAL_LINK_FORBIDDEN")).toBe(true);
  });

  it("detects entity-encoded external url(...) in style attributes", () => {
    const svg = '<svg data-export-schema-version="pbd.svg.v4"><rect style="fill:url(https&#x3a;//evil.example/x.svg)"/></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_EXTERNAL_LINK_FORBIDDEN")).toBe(true);
  });

  it("detects <script> tags", () => {
    const svg = '<svg data-export-schema-version="pbd.svg.v4"><script>alert(1)</script></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_ELEMENT_FORBIDDEN")).toBe(true);
  });

  it("detects <foreignObject> tags", () => {
    const svg = '<svg data-export-schema-version="pbd.svg.v4"><foreignObject><div>test</div></foreignObject></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_ELEMENT_FORBIDDEN")).toBe(true);
  });

  it("detects inline event handlers", () => {
    const svg = '<svg data-export-schema-version="pbd.svg.v4"><rect onload="alert(1)" /></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_EVENT_HANDLER_FORBIDDEN")).toBe(true);
  });

  it("detects @import in style blocks", () => {
    const svg = '<svg data-export-schema-version="pbd.svg.v4"><style>@import "https://evil.com";</style></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_STYLE_IMPORT_FORBIDDEN")).toBe(true);
  });

  it("detects XML processing instructions", () => {
    const svg = '<?xml-stylesheet type="text/xsl" href="exploit.xsl"?><svg data-export-schema-version="pbd.svg.v4"></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_PROCESSING_INSTRUCTION_FORBIDDEN")).toBe(true);
  });

  it("detects <!DOCTYPE declarations", () => {
    const svg = '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_DOCTYPE_FORBIDDEN")).toBe(true);
  });

  it("detects malformed XML", () => {
    const svg = '<svg><g><rect></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_XML_SYNTAX_ERROR")).toBe(true);
  });
});

describe("strict schema enforcement and additionalProperties: false", () => {
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
    expect(res.issues.some((i) => i.code === "BUNDLE_NOT_OBJECT" || i.code === "SCHEMA_NOT_AN_OBJECT")).toBe(true);
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
