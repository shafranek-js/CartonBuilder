import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(__dirname, "../..");

export function createPluginManifestValidators(rootDir = defaultRootDir) {
  const schemaDir = path.resolve(rootDir, "schemas");
  const pluginSchema = JSON.parse(
    fs.readFileSync(path.join(schemaDir, "plugin.manifest.v1.schema.json"), "utf8")
  );
  const catalogSchema = JSON.parse(
    fs.readFileSync(path.join(schemaDir, "plugins.manifest.v1.schema.json"), "utf8")
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(pluginSchema);
  const validatePlugin = ajv.getSchema(pluginSchema.$id);
  const validateCatalog = ajv.compile(catalogSchema);
  return { validatePlugin, validateCatalog };
}
export function formatSchemaErrors(errors) {
  return JSON.stringify(errors || [], null, 2);
}

export function assertValidPluginManifest(manifest, validatePlugin) {
  if (!validatePlugin(manifest)) {
    throw new Error(
      `Standalone plugin manifest validation failed: ${formatSchemaErrors(validatePlugin.errors)}`
    );
  }
}

export function assertValidPluginsCatalog(catalog, validateCatalog) {
  if (!validateCatalog(catalog)) {
    throw new Error(
      `Plugins catalog validation failed: ${formatSchemaErrors(validateCatalog.errors)}`
    );
  }
  const identities = new Set();
  for (const entry of catalog.plugins) {
    const identity = `${entry.plugin.id}@${entry.plugin.version}`;
    if (identities.has(identity)) throw new Error(`Duplicate plugin identity in catalog: ${identity}`);
    identities.add(identity);
  }
}

export function manifestArtifactFromBytes(bytes) {
  return {
    byteLength: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

export function canonicalPluginManifestPath(plugin) {
  return `${plugin.id}/${plugin.version}/plugin-manifest.json`;
}

export function buildCatalogEntry(plugin, manifestBytes) {
  return {
    manifestPath: canonicalPluginManifestPath(plugin),
    manifestArtifact: manifestArtifactFromBytes(manifestBytes),
    plugin,
  };
}

export function catalogEntryMatchesManifest(entry, manifest, manifestBytes) {
  return (
    entry.manifestPath === canonicalPluginManifestPath(manifest) &&
    isDeepStrictEqual(entry.manifestArtifact, manifestArtifactFromBytes(manifestBytes)) &&
    isDeepStrictEqual(entry.plugin, manifest)
  );
}
