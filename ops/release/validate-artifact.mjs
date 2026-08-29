import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateArtifactMetadata(value) {
  if (!value || typeof value !== "object") {
    throw new Error("invalid release metadata");
  }
  if (value.service !== "dasigap") {
    throw new Error("invalid release service");
  }
  if (typeof value.commitSha !== "string" || !/^[0-9a-f]{40}$/.test(value.commitSha)) {
    throw new Error("invalid release commit SHA");
  }
  return value.commitSha;
}

export function validateArtifactFiles(metadataPath, archivePath) {
  const metadata = JSON.parse(readFileSync(resolve(metadataPath), "utf8"));
  const sha = validateArtifactMetadata(metadata);
  const archive = statSync(resolve(archivePath));
  if (!archive.isFile() || archive.size < 1) {
    throw new Error("release archive is empty");
  }
  return sha;
}

function isDirectExecution() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectExecution()) {
  const [, , metadataPath, archivePath] = process.argv;
  if (!metadataPath || !archivePath) {
    console.error("release artifact validation failed");
    process.exitCode = 64;
  } else {
    try {
      process.stdout.write(`${validateArtifactFiles(metadataPath, archivePath)}\n`);
    } catch {
      console.error("release artifact validation failed");
      process.exitCode = 1;
    }
  }
}
