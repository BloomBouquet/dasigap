export const releasePaths: readonly string[];

export type ReleaseMetadata = {
  service: "dasigap";
  commitSha: string;
  builtAt: string;
  nodeMajor: 22;
  packageManager: "pnpm@11.24.0";
};

export function validateCommitSha(value: string): string;
export function createReleaseMetadata(commitSha: string, now?: Date): ReleaseMetadata;
export function createReleaseArtifact(
  commitSha: string,
  outputDir: string,
): {
  archivePath: string;
  metadataPath: string;
  metadata: ReleaseMetadata;
};
