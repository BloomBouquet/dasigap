import { describe, expect, it } from "vitest";

import { resolveLifecycleStatus } from "./lifecycle";

describe("resolveLifecycleStatus", () => {
  it("marks a future return deadline as RETURNABLE", () => {
    expect(
      resolveLifecycleStatus({
        now: new Date("2026-08-27T00:00:00Z"),
        returnDeadline: new Date("2026-08-30T00:00:00Z"),
        resaleStarted: false,
        listedExternally: false,
        soldAt: null,
      }),
    ).toBe("RETURNABLE");
  });
});
