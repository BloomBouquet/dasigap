import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../../app/api/health/route";
import { GET as GET_LIVE } from "../../app/api/health/live/route";

describe("deployment health endpoints", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps the legacy uncached liveness contract", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("reports the exact immutable release sha from the live endpoint", async () => {
    const release = "1".repeat(40);
    vi.stubEnv("DASIGAP_RELEASE_SHA", release);

    const response = await GET_LIVE();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok", release });
  });
});
