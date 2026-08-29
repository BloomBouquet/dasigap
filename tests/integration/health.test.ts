import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/health/readiness", () => ({
  checkReadiness: vi.fn(),
}));

import { GET } from "../../app/api/health/route";
import { GET as GET_LIVE } from "../../app/api/health/live/route";
import { GET as GET_READY } from "../../app/api/health/ready/route";
import { checkReadiness } from "../../src/health/readiness";

describe("deployment health endpoints", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

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

  it("returns ready without exposing dependency details", async () => {
    const release = "2".repeat(40);
    vi.stubEnv("DASIGAP_RELEASE_SHA", release);
    vi.mocked(checkReadiness).mockResolvedValue(true);

    const response = await GET_READY();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({ status: "ready", release });
    expect(JSON.stringify(body)).not.toMatch(/database|storage|bucket|endpoint|secret/i);
  });

  it("returns a sanitized 503 when dependencies are unavailable", async () => {
    const release = "3".repeat(40);
    vi.stubEnv("DASIGAP_RELEASE_SHA", release);
    vi.mocked(checkReadiness).mockResolvedValue(false);

    const response = await GET_READY();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({ status: "unavailable", release });
    expect(JSON.stringify(body)).not.toMatch(/database|storage|bucket|endpoint|secret/i);
  });
});
