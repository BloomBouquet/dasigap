import { afterEach, describe, expect, it, vi } from "vitest";

const readiness = vi.hoisted(() => ({
  checkReadiness: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("../../src/health/readiness", () => ({
  checkReadiness: readiness.checkReadiness,
}));

import { GET as getLive } from "../../app/api/health/live/route";
import { GET as getReady } from "../../app/api/health/ready/route";

describe("health API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    readiness.checkReadiness.mockReset();
  });

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

  it("returns 200 only when required dependencies are ready", async () => {
    vi.stubEnv("DASIGAP_RELEASE_SHA", "b".repeat(40));
    readiness.checkReadiness.mockResolvedValueOnce(true);

    const response = await getReady();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      service: "dasigap",
      release: "b".repeat(40),
    });
  });

  it("fails closed without leaking dependency details", async () => {
    readiness.checkReadiness.mockResolvedValueOnce(false);

    const response = await getReady();
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(JSON.parse(text)).toEqual({
      status: "not_ready",
      service: "dasigap",
      release: "unknown",
    });
    expect(text).not.toContain("DATABASE_URL");
    expect(text).not.toContain("OBJECT_STORAGE_ENDPOINT");
    expect(text).not.toContain("postgresql://");
    expect(text).not.toContain("dasigap-ci-secret");
  });
});
