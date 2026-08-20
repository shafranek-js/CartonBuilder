import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { canonicalizeJson } from "../../../src/workflow/canonicalJson.js";
import { sha256, sha256Async, utf8ByteLength } from "../../../src/workflow/crypto.js";
import { validateModelJson } from "../../../src/workflow/validateModelJson.js";
import { validateSemanticSvg, scanSvgSecurity } from "../../../src/workflow/validateSemanticSvg.js";
import {
  validateCartonWorkflowBundle,
  CONTRACT_VERSION,
  WORKFLOW_MODE,
  ALLOWED_CARTON_TYPES,
} from "../../../src/workflow/workflowValidator.js";

const fixturesDir = path.resolve("src/workflow/fixtures");

function loadFixture(filename) {
  const filepath = path.join(fixturesDir, filename);
  return JSON.parse(fs.readFileSync(filepath, "utf8"));
}

describe("canonical JSON serializer", () => {
  it("serializes objects with sorted keys regardless of insertion order", () => {
    const objA = { z: 1, a: 2, m: { b: 3, a: 4 } };
    const objB = { a: 2, m: { a: 4, b: 3 }, z: 1 };
    expect(canonicalizeJson(objA)).toBe(canonicalizeJson(objB));
    expect(canonicalizeJson(objA)).toBe('{"a":2,"m":{"a":4,"b":3},"z":1}');
  });

  it("preserves array ordering without sorting elements", () => {
    const arr = [3, 1, 2];
    expect(canonicalizeJson(arr)).toBe("[3,1,2]");
  });

  it("handles null, boolean, numbers, strings correctly", () => {
    expect(canonicalizeJson(null)).toBe("null");
    expect(canonicalizeJson(123.45)).toBe("123.45");
    expect(canonicalizeJson("test")).toBe('"test"');
    expect(canonicalizeJson(true)).toBe("true");
  });
});

describe("browser-safe SHA-256 and UTF-8 utilities", () => {
  it("computes standard SHA-256 digests accurately", async () => {
    // Standard test vectors
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256("hello world")).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");

    const asyncHash = await sha256Async("hello world");
    expect(asyncHash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("calculates exact UTF-8 byte lengths", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("тест")).toBe(8);
  });
});

describe("golden fixtures validation", () => {
  const fixtureNames = [
    ["RTE", "rte-workflow.v1.json"],
    ["STE", "ste-workflow.v1.json"],
    ["TT_SL123", "tt_sl123-workflow.v1.json"],
  ];

  it.each(fixtureNames)("passes complete validation for %s golden fixture", (_name, filename) => {
    const bundle = loadFixture(filename);
    const result = validateCartonWorkflowBundle(bundle);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.issues).toEqual([]);

    expect(bundle.contractVersion).toBe(CONTRACT_VERSION);
    expect(bundle.workflowMode).toBe(WORKFLOW_MODE);
    expect(ALLOWED_CARTON_TYPES).toContain(bundle.source.cartonType);
    expect(bundle.capabilities.artwork2d).toBe(true);
    expect(bundle.capabilities.technicalRender).toBe(true);

    // Verify Model JSON validity & SHA-256
    const modelValid = validateModelJson(bundle.modelJson);
    expect(modelValid.valid).toBe(true);
    expect(sha256(canonicalizeJson(bundle.modelJson))).toBe(bundle.modelJsonSha256);

    // Verify Semantic SVG validity & SHA-256
    const svgValid = validateSemanticSvg(bundle.semanticSvg.markup);
    expect(svgValid.valid).toBe(true);
    expect(sha256(bundle.semanticSvg.markup)).toBe(bundle.semanticSvg.sha256);
    expect(utf8ByteLength(bundle.semanticSvg.markup)).toBe(bundle.semanticSvg.byteLength);
  });
});

describe("mandatory negative validation tests", () => {
  it("rejects non-object bundle", () => {
    const res = validateCartonWorkflowBundle(null);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "BUNDLE_NOT_OBJECT")).toBe(true);
  });

  it("rejects invalid or unknown contract version", () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    bundle.contractVersion = "carton-workflow.v2";
    const res = validateCartonWorkflowBundle(bundle);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "CONTRACT_VERSION_INVALID")).toBe(true);
  });

  it("rejects invalid workflowMode", () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    bundle.workflowMode = "creative";
    const res = validateCartonWorkflowBundle(bundle);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "WORKFLOW_MODE_INVALID")).toBe(true);
  });

  it("rejects unknown carton type", () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    bundle.source.cartonType = "UNKNOWN_BOX";
    const res = validateCartonWorkflowBundle(bundle);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "SOURCE_CARTON_TYPE_INVALID")).toBe(true);
  });

  it("rejects cross-type mismatch between source and modelJson", () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    bundle.source.cartonType = "STE"; // modelJson.input.cartonType is RTE
    const res = validateCartonWorkflowBundle(bundle);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "CROSS_CARTON_TYPE_MISMATCH")).toBe(true);
  });

  it("detects mutated Model JSON through SHA-256 verification", () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    // Mutate inner dimension
    bundle.modelJson.resolvedDimensions.inner.width += 1.0;
    const res = validateCartonWorkflowBundle(bundle);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "MODEL_SHA256_MISMATCH")).toBe(true);
  });

  it("detects mutated SVG markup through SHA-256 and byteLength verification", () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    bundle.semanticSvg.markup += "<!-- comment -->";
    const res = validateCartonWorkflowBundle(bundle);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "SVG_SHA256_MISMATCH")).toBe(true);
    expect(res.issues.some((i) => i.code === "SVG_BYTE_LENGTH_MISMATCH")).toBe(true);
  });

  it("detects oversized SVG payload", () => {
    const bundle = loadFixture("rte-workflow.v1.json");
    // Restrict maxPayloadBytes to 1000 bytes
    const res = validateCartonWorkflowBundle(bundle, { maxPayloadBytes: 1000 });
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "PAYLOAD_OVERSIZED")).toBe(true);
  });

  it("rejects SVG containing <script> tags", () => {
    const maliciousSvg = '<svg data-export-schema-version="pbd.svg.v4"><script>alert(1)</script></svg>';
    const securityIssues = scanSvgSecurity(maliciousSvg);
    expect(securityIssues.some((i) => i.code === "SVG_SECURITY_SCRIPT_FORBIDDEN")).toBe(true);

    const bundle = loadFixture("rte-workflow.v1.json");
    bundle.semanticSvg.markup = bundle.semanticSvg.markup.replace("</svg>", "<script>alert(1)</script></svg>");
    bundle.semanticSvg.byteLength = utf8ByteLength(bundle.semanticSvg.markup);
    bundle.semanticSvg.sha256 = sha256(bundle.semanticSvg.markup);

    const res = validateCartonWorkflowBundle(bundle);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "SVG_SECURITY_SCRIPT_FORBIDDEN")).toBe(true);
  });

  it("rejects SVG containing <foreignObject> tags", () => {
    const maliciousSvg = '<svg data-export-schema-version="pbd.svg.v4"><foreignObject><div>bad</div></foreignObject></svg>';
    const securityIssues = scanSvgSecurity(maliciousSvg);
    expect(securityIssues.some((i) => i.code === "SVG_SECURITY_FOREIGNOBJECT_FORBIDDEN")).toBe(true);
  });

  it("rejects SVG containing inline event handlers", () => {
    const maliciousSvg = '<svg data-export-schema-version="pbd.svg.v4"><rect onload="alert(1)" /></svg>';
    const securityIssues = scanSvgSecurity(maliciousSvg);
    expect(securityIssues.some((i) => i.code === "SVG_SECURITY_EVENT_HANDLER_FORBIDDEN")).toBe(true);
  });

  it("rejects SVG containing javascript: URIs", () => {
    const maliciousSvg = '<svg data-export-schema-version="pbd.svg.v4"><a href="javascript:alert(1)"><path /></a></svg>';
    const securityIssues = scanSvgSecurity(maliciousSvg);
    expect(securityIssues.some((i) => i.code === "SVG_SECURITY_JAVASCRIPT_URI_FORBIDDEN")).toBe(true);
  });

  it("rejects SVG containing external network links", () => {
    const maliciousSvg = '<svg data-export-schema-version="pbd.svg.v4"><image href="https://example.com/leak.png" /></svg>';
    const securityIssues = scanSvgSecurity(maliciousSvg);
    expect(securityIssues.some((i) => i.code === "SVG_SECURITY_EXTERNAL_LINK_FORBIDDEN")).toBe(true);
  });
});
