import fs from "node:fs";
import path from "node:path";
import { createModularEngine } from "../../../../Packaging Box Designer-stage1/src/engine/modularEngine.mjs";
import { canonicalizeJson } from "../canonicalJson.js";
import { sha256, utf8ByteLength } from "../crypto.js";
import { validateCartonWorkflowBundle } from "../workflowValidator.js";

const engine = createModularEngine();

const fixtureDefs = [
  {
    filename: "rte-workflow.v1.json",
    cartonType: "RTE",
    input: {
      width: 120.6,
      height: 161.1,
      depth: 60.6,
      thickness: 0.46,
      dimensionReference: "INNER",
      designMode: "AUTOMATIC",
      cartonType: "RTE",
      orientation: "FRONT",
      engineeringOverrides: {},
    },
    capabilities: {
      artwork2d: true,
      flatExport: true,
      foldPreview: true,
      technicalRender: true,
    }
  },
  {
    filename: "ste-workflow.v1.json",
    cartonType: "STE",
    input: {
      width: 120.6,
      height: 161.1,
      depth: 60.6,
      thickness: 0.46,
      dimensionReference: "INNER",
      designMode: "AUTOMATIC",
      cartonType: "STE",
      orientation: "FRONT",
      engineeringOverrides: {},
    },
    capabilities: {
      artwork2d: true,
      flatExport: true,
      foldPreview: true,
      technicalRender: true,
    }
  },
  {
    filename: "tt_sl123-workflow.v1.json",
    cartonType: "TT_SL123",
    input: {
      width: 120.6,
      height: 161.1,
      depth: 60.6,
      thickness: 0.46,
      dimensionReference: "INNER",
      designMode: "AUTOMATIC",
      cartonType: "TT_SL123",
      orientation: "FRONT",
      snapLockProfile: "ecma-a55.20.01.03-v0.1",
      engineeringOverrides: {},
    },
    capabilities: {
      artwork2d: true,
      flatExport: true,
      foldPreview: true,
      technicalRender: true,
    }
  }
];

const fixturesDir = path.resolve("src/workflow/fixtures");

for (const def of fixtureDefs) {
  const model = engine.generateCarton(def.input);
  const modelExport = engine.buildModelExport(model);
  const svgResult = engine.renderSvgMarkupV4(model);

  const canonicalModelString = canonicalizeJson(modelExport);
  const modelSha256 = sha256(canonicalModelString);

  const svgMarkup = svgResult.markup;
  const svgByteLength = utf8ByteLength(svgMarkup);
  const svgSha256 = sha256(svgMarkup);

  const bundle = {
    contractVersion: "carton-workflow.v1",
    workflowMode: "technical",
    source: {
      producer: "packaging-box-designer",
      engineVersion: model.engineVersion || "0.9.34",
      modelSchemaVersion: "pbd.model.v1",
      svgSchemaVersion: "pbd.svg.v4",
      cartonType: def.cartonType,
      profileIds: model.ruleResolution?.activeProfiles || [],
      referenceOnly: true,
      productionCertified: false,
    },
    modelJson: modelExport,
    modelJsonSha256: modelSha256,
    semanticSvg: {
      mediaType: "image/svg+xml",
      byteLength: svgByteLength,
      sha256: svgSha256,
      units: "mm",
      markup: svgMarkup,
    },
    capabilities: def.capabilities,
  };

  const validation = validateCartonWorkflowBundle(bundle);
  if (!validation.valid) {
    console.error(`Validation failed for ${def.filename}:`, validation.errors);
    process.exit(1);
  }

  const targetPath = path.join(fixturesDir, def.filename);
  fs.writeFileSync(targetPath, JSON.stringify(bundle, null, 2), "utf8");
  console.log(`Generated ${def.filename}:`);
  console.log(`  modelJsonSha256: ${modelSha256}`);
  console.log(`  semanticSvg.sha256: ${svgSha256} (${svgByteLength} bytes)`);
}
