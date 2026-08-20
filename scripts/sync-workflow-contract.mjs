/**
 * Strict synchronization command to pull the manifest-backed carton-workflow package
 * into CartonBuilder using atomicManifestSyncPackage.
 * Requires explicit --source <path> to a built package directory containing package-manifest.json.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPathSafe, atomicSyncManifestPackage } from "./lib/atomicManifestSync.mjs";

export { isPathSafe };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const destDir = path.resolve(rootDir, "src/workflow");

export function syncWorkflowContract(sourcePath, customDestDir = destDir) {
  if (!sourcePath) {
    throw new Error("Error: --source <path-to-package-directory> is required.");
  }
  const packageSourceDir = path.resolve(sourcePath);
  console.log(`Syncing carton-workflow package from: ${packageSourceDir}\n`);

  const manifest = atomicSyncManifestPackage({
    sourceDir: packageSourceDir,
    destDir: customDestDir,
    manifestFilename: "package-manifest.json",
  });

  console.log(`✓ Destination directory atomically updated at ${customDestDir}.`);
  console.log(`✓ Synced Package: ${manifest.packageName}@${manifest.packageVersion} (PBD commit ${manifest.pbdCommit})`);
  console.log("\nCarton workflow contract synchronization completed successfully.");
  return manifest;
}

// CLI entrypoint execution
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const sourceArgIndex = args.indexOf("--source");
  if (sourceArgIndex === -1 || !args[sourceArgIndex + 1]) {
    console.error("Error: --source <path-to-package-directory> is required.");
    console.error("Example: node scripts/sync-workflow-contract.mjs --source ../Packaging\\ Box\\ Designer-stage1/dist/packages/carton-workflow-v1");
    process.exit(1);
  }

  try {
    syncWorkflowContract(args[sourceArgIndex + 1]);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
