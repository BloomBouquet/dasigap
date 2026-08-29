import { describe, expect, it } from "vitest";

import {
  createReleaseMetadata,
  releasePaths,
  validateCommitSha,
} from "./create-artifact.mjs";

describe("production artifact metadata", () => {
  it("accepts only a full commit SHA", () => {
    expect(() => validateCommitSha("abc123")).toThrow("full commit SHA");
    expect(validateCommitSha("A".repeat(40))).toBe("a".repeat(40));
  });

  it("contains only immutable release identity", () => {
    expect(
      createReleaseMetadata("b".repeat(40), new Date("2026-08-29T00:00:00Z")),
    ).toEqual({
      service: "dasigap",
      commitSha: "b".repeat(40),
      builtAt: "2026-08-29T00:00:00.000Z",
      nodeMajor: 22,
      packageManager: "pnpm@11.24.0",
    });
  });

  it("packages an explicit allowlist without environment files", () => {
    expect(releasePaths).toEqual([
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
    ]);
    expect(releasePaths.some((path) => /(^|\/)\.env($|\.)/.test(path))).toBe(false);
  });
});
