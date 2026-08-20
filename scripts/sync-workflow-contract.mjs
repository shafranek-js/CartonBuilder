/**
 * Deterministic synchronization command to pull the versioned carton-workflow contract package
 * and golden fixtures from Packaging Box Designer into CartonBuilder.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const sourceArgIndex = args.indexOf("--source");
const pbdSourceDir = sourceArgIndex >= 0 && args[sourceArgIndex + 1]
  ? path.resolve(args[sourceArgIndex + 1])
  : path.resolve(rootDir, "../Packaging Box Designer-stage1");

console.log(`Syncing carton-workflow.v1 contract from: ${pbdSourceDir}`);

if (!fs.existsSync(pbdSourceDir)) {
  console.error(`Error: Source directory "${pbdSourceDir}" does not exist.`);
  process.exit(1);
}

// 1. Sync Schema
const schemaSource = path.join(pbdSourceDir, "schemas/carton-workflow.v1.schema.json");
const schemaTargetDir = path.join(rootDir, "src/workflow");
fs.mkdirSync(schemaTargetDir, { recursive: true });
fs.copyFileSync(schemaSource, path.join(schemaTargetDir, "cartonWorkflowSchema.json"));
console.log("✓ Copied schema: src/workflow/cartonWorkflowSchema.json");

// 2. Sync Export validators needed for standalone execution
const exportSourceDir = path.join(pbdSourceDir, "src/export");
const exportTargetDir = path.join(rootDir, "src/workflow/pbd-export");
fs.mkdirSync(exportTargetDir, { recursive: true });
for (const file of ["modelJson.mjs", "svgMetadata.mjs", "svgGeometry.mjs", "svgAnnotations.mjs", "svgDiagnostics.mjs", "svgBounds.mjs"]) {
  const src = path.join(exportSourceDir, file);
  if (fs.existsSync(src)) {
    const dst = path.join(exportTargetDir, file.replace(/\.mjs$/, ".js"));
    let content = fs.readFileSync(src, "utf8");
    content = content.replace(/\.mjs/g, ".js");
    fs.writeFileSync(dst, content, "utf8");
    console.log(`✓ Synced authoritative PBD export validator: src/workflow/pbd-export/${path.basename(dst)}`);
  }
}

// 3. Sync Contract Package files
const contractSourceDir = path.join(pbdSourceDir, "src/workflow");
const contractFiles = ["validator.mjs", "builder.mjs", "crypto.mjs", "security.mjs", "index.mjs"];
for (const file of contractFiles) {
  const src = path.join(contractSourceDir, file);
  const dst = path.join(schemaTargetDir, file.replace(/\.mjs$/, ".js"));
  let content = fs.readFileSync(src, "utf8");
  content = content.replace(/\.mjs/g, ".js");
  content = content.replace('../export/modelJson.js', './pbd-export/modelJson.js');
  content = content.replace('../export/svgMetadata.js', './pbd-export/svgMetadata.js');
  fs.writeFileSync(dst, content, "utf8");
  console.log(`✓ Synced contract module: src/workflow/${path.basename(dst)}`);
}

// 4. Sync Golden Fixtures
const fixturesSourceDir = path.join(pbdSourceDir, "tests/fixtures/workflow");
const fixturesTargetDir = path.join(rootDir, "src/workflow/fixtures");
fs.mkdirSync(fixturesTargetDir, { recursive: true });

for (const fixtureName of ["rte-workflow.v1.json", "ste-workflow.v1.json", "tt_sl123-workflow.v1.json"]) {
  const src = path.join(fixturesSourceDir, fixtureName);
  const dst = path.join(fixturesTargetDir, fixtureName);
  fs.copyFileSync(src, dst);
  console.log(`✓ Synced golden fixture: src/workflow/fixtures/${fixtureName}`);
}

console.log("\nCarton workflow contract synchronization completed successfully.");
