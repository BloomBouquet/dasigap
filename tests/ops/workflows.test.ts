import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function workflow(path: string) {
  return readFileSync(path, "utf8");
}

describe("production operations workflows", () => {
  it("deploys only a verified release build with pinned SSH trust", () => {
    const text = workflow(".github/workflows/deploy-production-release.yml");

    expect(text).toContain("workflow_dispatch:");
    expect(text).toContain("environment: production");
    expect(text).toContain("group: dasigap-production-deploy");
    expect(text).toContain("cancel-in-progress: false");
    expect(text).toContain("PRODUCTION_KNOWN_HOSTS");
    expect(text).toContain("build-production-release.yml");
    expect(text).toContain("dasigap-production-");
    expect(text).toContain("actions/download-artifact@v4");
    expect(text).not.toContain("ssh-keyscan");
    expect(text).not.toContain("StrictHostKeyChecking=no");
    expect(text).not.toContain("git pull");
  });

  it("rolls back only to an installed release without migration or artifact download", () => {
    const text = workflow(".github/workflows/rollback-production-release.yml");

    expect(text).toContain("workflow_dispatch:");
    expect(text).toContain("target_sha:");
    expect(text).toContain("environment: production");
    expect(text).toContain("group: dasigap-production-deploy");
    expect(text).toContain("cancel-in-progress: false");
    expect(text).toContain("PRODUCTION_KNOWN_HOSTS");
    expect(text).toContain("rollback-release.sh");
    expect(text).not.toContain("actions/download-artifact");
    expect(text).not.toContain("pnpm install");
    expect(text).not.toContain("prisma migrate");
    expect(text).not.toContain("git fetch");
    expect(text).not.toContain("git checkout");
    expect(text).not.toContain("ssh-keyscan");
    expect(text).not.toContain("StrictHostKeyChecking=no");
  });
});
