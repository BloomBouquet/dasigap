import { describe, expect, it } from "vitest";

import { GET } from "../../app/api/health/route";

describe("deployment health endpoint", () => {
  it("returns an uncached ok response for container liveness checks", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
