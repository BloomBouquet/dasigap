import { describe, expect, it } from "vitest";

import { getReleaseSha } from "./release";

describe("release identity", () => {
  it("accepts an exact lowercase 40-character commit SHA", () => {
    const sha = "a".repeat(40);
    expect(getReleaseSha(sha)).toBe(sha);
  });

  it.each([
    undefined,
    "",
    "A".repeat(40),
    "a".repeat(39),
    "a".repeat(41),
    "g".repeat(40),
  ])("falls back to unknown for invalid value %s", (value) => {
    expect(getReleaseSha(value)).toBe("unknown");
  });
});
