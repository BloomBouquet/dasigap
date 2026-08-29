import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("production image release identity", () => {
  it("binds runtime images and health checks to the exact immutable release sha", () => {
    const dockerfile = read("Dockerfile");
    const imageWorkflow = read(".github/workflows/production-image.yml");
    const compose = read("deploy/compose.production.yml");

    expect(dockerfile).toContain("ARG RELEASE_SHA=unknown");
    expect(dockerfile).toContain("ENV DASIGAP_RELEASE_SHA=$RELEASE_SHA");
    expect(dockerfile).toContain("/api/health/live");

    expect(imageWorkflow).toContain("RELEASE_SHA=${{ github.sha }}");
    expect(imageWorkflow).toContain("/api/health/live");
    expect(imageWorkflow).toContain("release");

    expect(compose).toContain("127.0.0.1:3000:3000");
    expect(compose).toContain("/api/health/live");
    expect(compose).not.toContain('"0.0.0.0:3000:3000"');
  });
});
