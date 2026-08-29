import { describe, expect, it } from "vitest";

import { validateArtifactMetadata } from "./validate-artifact.mjs";

describe("downloaded production artifact", () => {
  it("accepts only Dasigap metadata with a full commit SHA", () => {
    expect(
      validateArtifactMetadata({ service: "dasigap", commitSha: "a".repeat(40) }),
    ).toBe("a".repeat(40));

    expect(() =>
      validateArtifactMetadata({ service: "other", commitSha: "a".repeat(40) }),
    ).toThrow();

    expect(() =>
      validateArtifactMetadata({ service: "dasigap", commitSha: "../../etc" }),
    ).toThrow();
  });
});
