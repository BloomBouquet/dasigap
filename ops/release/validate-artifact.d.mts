export type ArtifactMetadata = {
  service?: unknown;
  commitSha?: unknown;
  [key: string]: unknown;
};

export function validateArtifactMetadata(value: ArtifactMetadata): string;
export function validateArtifactFiles(metadataPath: string, archivePath: string): string;
