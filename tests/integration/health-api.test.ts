import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getLive } from "../../app/api/health/live/route";

describe("health API", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns liveness with the release SHA and no-store", async () => {
    vi.stubEnv("DASIGAP_RELEASE_SHA", "a".repeat(40));

    const response = await getLive();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "dasigap",
      release: "a".repeat(40),
    });
  });

  it("uses unknown for a missing or invalid release SHA", async () => {
    vi.stubEnv("DASIGAP_RELEASE_SHA", "not-a-sha");

    const response = await getLive();

    expect((await response.json()).release).toBe("unknown");
  });
});
