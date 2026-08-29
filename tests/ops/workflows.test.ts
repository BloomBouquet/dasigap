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

describe("protected production workflows", () => {
  it("protects deploy and rollback with shared serialization, pinned SSH, and exact main SHAs", () => {
    const deploy = read(".github/workflows/deploy-production.yml");
    const rollback = read(".github/workflows/rollback-production.yml");
    const combined = `${deploy}\n${rollback}`;

    expect(deploy).toContain("environment: production");
    expect(rollback).toContain("environment: production");
    expect(deploy).toContain("group: dasigap-production-deploy");
    expect(rollback).toContain("group: dasigap-production-deploy");
    expect(deploy).toContain("cancel-in-progress: false");
    expect(rollback).toContain("cancel-in-progress: false");

    expect(deploy).toContain("DEPLOY_KNOWN_HOSTS");
    expect(rollback).toContain("DEPLOY_KNOWN_HOSTS");
    expect(deploy).toContain("StrictHostKeyChecking=yes");
    expect(rollback).toContain("StrictHostKeyChecking=yes");
    expect(deploy).toContain("PRODUCTION_BASE_URL");
    expect(rollback).toContain("PRODUCTION_BASE_URL");

    expect(deploy).toContain("^[0-9a-f]{40}$");
    expect(rollback).toContain("^[0-9a-f]{40}$");
    expect(deploy).toContain("fetch-depth: 0");
    expect(rollback).toContain("fetch-depth: 0");
    expect(deploy).toContain('git merge-base --is-ancestor "$IMAGE_SHA" origin/main');
    expect(rollback).toContain('git merge-base --is-ancestor "$IMAGE_SHA" origin/main');

    expect(combined).not.toContain("ssh-keyscan");
    expect(combined).not.toContain("StrictHostKeyChecking=no");
    expect(combined).not.toContain("git pull");
  });

  it("keeps rollback application-only and verifies public readiness with the exact target sha", () => {
    const deploy = read(".github/workflows/deploy-production.yml");
    const rollback = read(".github/workflows/rollback-production.yml");

    expect(deploy).toContain("/api/health/ready");
    expect(rollback).toContain("/api/health/ready");
    expect(deploy).toContain("--restore-previous-or-stop");
    expect(rollback).toContain("--restore-previous-or-stop");
    expect(rollback).not.toContain("migrate-sha-");
    expect(rollback).not.toContain("prisma migrate");
  });
});
