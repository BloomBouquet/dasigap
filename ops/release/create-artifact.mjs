import { execFileSync } from "node:child_process";
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const releasePaths = [
  ".next",
  "app",
  "components",
  "public",
  "src",
  "prisma",
  "ops",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "next.config.ts",
  "release-metadata.json",
];

export function validateCommitSha(value) {
  if (!/^[0-9a-f]{40}$/i.test(value ?? "")) {
    throw new Error("full commit SHA required");
  }
  return value.toLowerCase();
}

export function createReleaseMetadata(commitSha, now = new Date()) {
  return {
    service: "dasigap",
    commitSha: validateCommitSha(commitSha),
    builtAt: now.toISOString(),
    nodeMajor: 22,
    packageManager: "pnpm@11.24.0",
  };
}

export function createReleaseArtifact(commitSha, outputDir) {
  const sha = validateCommitSha(commitSha);
  const output = resolve(outputDir);
  const metadataPath = resolve("release-metadata.json");
  const archivePath = resolve(output, `dasigap-release-${sha}.tgz`);
  const outputMetadataPath = resolve(output, "release-metadata.json");

  accessSync(resolve(".next"), constants.R_OK);

  if (existsSync(metadataPath)) {
    throw new Error("release-metadata.json already exists in repository root");
  }

  mkdirSync(output, { recursive: true });
  const metadata = createReleaseMetadata(sha);
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });

  try {
    execFileSync("tar", ["-czf", archivePath, ...releasePaths], {
      stdio: "inherit",
    });
    copyFileSync(metadataPath, outputMetadataPath);
  } finally {
    rmSync(metadataPath, { force: true });
  }

  return { archivePath, metadataPath: outputMetadataPath, metadata };
}

function isDirectExecution() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectExecution()) {
  const [, , commitSha, outputDir] = process.argv;
  if (!commitSha || !outputDir) {
    console.error("usage: node ops/release/create-artifact.mjs <commit-sha> <output-dir>");
    process.exitCode = 64;
  } else {
    try {
      createReleaseArtifact(commitSha, outputDir);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "release artifact creation failed");
      process.exitCode = 1;
    }
  }
}
