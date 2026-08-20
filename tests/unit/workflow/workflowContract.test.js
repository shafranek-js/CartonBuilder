import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  validateCartonWorkflowBundle,
  CONTRACT_VERSION,
  WORKFLOW_MODE,
  ALLOWED_CARTON_TYPES,
  scanSvgSecurity,
  sha256,
  sha256Async,
  utf8ByteLength,
  validateModelExport,
  validateSvgV4Export,
} from "../../../src/workflow/index.js";

const fixturesDir = path.resolve("src/workflow/fixtures");

function loadFixture(filename) {
  const filepath = path.join(fixturesDir, filename);
  return JSON.parse(fs.readFileSync(filepath, "utf8"));
}

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
    expect(typeof bundle.source.artifactSha256).toBe("string");
    expect(bundle.source.artifactSha256).toHaveLength(64);
    expect(typeof bundle.semanticSvg.assetId).toBe("string");
    expect(bundle.semanticSvg.assetId.length).toBeGreaterThan(0);

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

    // SHA-256 and byteLength verification
    expect(await sha256Async(bundle.modelJson.text)).toBe(bundle.modelJson.sha256);
    expect(utf8ByteLength(bundle.modelJson.text)).toBe(bundle.modelJson.byteLength);

    expect(await sha256Async(bundle.semanticSvg.markup)).toBe(bundle.semanticSvg.sha256);
    expect(utf8ByteLength(bundle.semanticSvg.markup)).toBe(bundle.semanticSvg.byteLength);
  });
});

describe("preflight payload size limits", () => {
  it("rejects oversized Model JSON (>10 MB default or custom limit)", async () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    const result = await validateCartonWorkflowBundle(bundle, { maxModelBytes: 1000 });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "MODEL_OVERSIZED")).toBe(true);
  });

  it("rejects oversized SVG (>15 MB default or custom limit)", async () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    const result = await validateCartonWorkflowBundle(bundle, { maxSvgBytes: 1000 });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "SVG_OVERSIZED")).toBe(true);
  });

  it("rejects oversized total bundle (>25 MB default or custom limit)", async () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    const result = await validateCartonWorkflowBundle(bundle, { maxBundleBytes: 2000 });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "BUNDLE_OVERSIZED")).toBe(true);
  });
});

describe("XML/SVG security preflight and entity decoding", () => {
  it("detects entity-encoded javascript: URI schemes", () => {
    const svg = '<svg data-export-schema-version="pbd.svg.v4"><a href="java&#x73;cript:alert(1)"><path /></a></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_JAVASCRIPT_URI_FORBIDDEN")).toBe(true);
  });

  it("detects entity-encoded https: external links", () => {
    const svg = '<svg data-export-schema-version="pbd.svg.v4"><image href="https&#x3a;//example.com/leak.png" /></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_EXTERNAL_LINK_FORBIDDEN")).toBe(true);
  });

  it("detects <script> tags", () => {
    const svg = '<svg data-export-schema-version="pbd.svg.v4"><script>alert(1)</script></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_SCRIPT_FORBIDDEN")).toBe(true);
  });

  it("detects <foreignObject> tags", () => {
    const svg = '<svg data-export-schema-version="pbd.svg.v4"><foreignObject><div>test</div></foreignObject></svg>';
    const issues = scanSvgSecurity(svg);
    expect(issues.some((i) => i.code === "SVG_SECURITY_FOREIGNOBJECT_FORBIDDEN")).toBe(true);
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
});

describe("schema/runtime parity with PBD canonical validators", () => {
  it("identically rejects Model JSON missing visibleLayers", async () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    const modelObj = JSON.parse(bundle.modelJson.text);
    delete modelObj.exportMetadata.visibleLayers;

    // Test direct PBD validateModelExport
    const pbdResult = validateModelExport(modelObj);
    expect(pbdResult.valid).toBe(false);
    expect(pbdResult.issues.some((i) => i.code === "EXPORT_METADATA_STATE_INVALID")).toBe(true);

    // Test consumer bundle validator
    bundle.modelJson.text = JSON.stringify(modelObj);
    bundle.modelJson.byteLength = utf8ByteLength(bundle.modelJson.text);
    bundle.modelJson.sha256 = sha256(bundle.modelJson.text);

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
    bundle.modelJson.sha256 = sha256(bundle.modelJson.text);

    const bundleResult = await validateCartonWorkflowBundle(bundle);
    expect(bundleResult.valid).toBe(false);
    expect(bundleResult.issues.some((i) => i.code === "EXPORT_VALIDATION_INVALID")).toBe(true);
  });
});

describe("mandatory negative integrity tests", () => {
  it("rejects non-object bundle", async () => {
    const res = await validateCartonWorkflowBundle(null);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "BUNDLE_NOT_OBJECT")).toBe(true);
  });

  it("rejects invalid contract version", async () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    bundle.contractVersion = "carton-workflow.v2";
    const res = await validateCartonWorkflowBundle(bundle);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "CONTRACT_VERSION_INVALID")).toBe(true);
  });

  it("rejects unknown carton type", async () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    bundle.source.cartonType = "UNKNOWN_BOX";
    const res = await validateCartonWorkflowBundle(bundle);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "SOURCE_CARTON_TYPE_INVALID")).toBe(true);
  });

  it("rejects cross-type mismatch between source and modelJson", async () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    bundle.source.cartonType = "STE"; // modelJson.input.cartonType is RTE
    const res = await validateCartonWorkflowBundle(bundle);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "CROSS_CARTON_TYPE_MISMATCH")).toBe(true);
  });

  it("detects mutated Model JSON via SHA-256", async () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    bundle.modelJson.text += " ";
    // byteLength updated, but sha256 left as original
    bundle.modelJson.byteLength = utf8ByteLength(bundle.modelJson.text);
    const res = await validateCartonWorkflowBundle(bundle);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "MODEL_SHA256_MISMATCH")).toBe(true);
  });

  it("detects mutated SVG markup via SHA-256", async () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    bundle.semanticSvg.markup += "<!-- comment -->";
    bundle.semanticSvg.byteLength = utf8ByteLength(bundle.semanticSvg.markup);
    const res = await validateCartonWorkflowBundle(bundle);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "SVG_SHA256_MISMATCH")).toBe(true);
  });
});
