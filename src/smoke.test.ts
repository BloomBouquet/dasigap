import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("loads the Dasigap unit test environment", () => {
    expect("다시값").toContain("다시");
  });
});
