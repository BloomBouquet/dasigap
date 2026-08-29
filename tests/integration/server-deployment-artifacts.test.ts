import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("server deployment artifacts", () => {
  it("keeps the application bound to loopback with private production env", () => {
    const compose = read("deploy/compose.production.yml");

    expect(compose).toContain("${DASIGAP_IMAGE:?DASIGAP_IMAGE is required}");
    expect(compose).toContain("127.0.0.1:3000:3000");
    expect(compose).toContain("/etc/dasigap/dasigap.env");
    expect(compose).toContain("restart: unless-stopped");
    expect(compose).toContain("/api/health/live");
    expect(compose).not.toMatch(/(?:^|\s)-\s*["']?3000:3000/);
  });

  it("documents the validation admin allowlist in the production env template", () => {
    const env = read("deploy/.env.production.example");

    expect(env).toContain("VALIDATION_ADMIN_USER_IDS=");
  });

  it("publishes an immutable Prisma migration image alongside the app image", () => {
    const dockerfile = read("Dockerfile");
    const workflow = read(".github/workflows/production-image.yml");

    expect(dockerfile).toContain("AS migrator");
    expect(dockerfile).toContain('["pnpm", "prisma", "migrate", "deploy"]');
    expect(workflow).toContain("target: migrator");
    expect(workflow).toContain("ghcr.io/bloombouquet/dasigap:migrate-sha-${{ github.sha }}");
  });

  it("deploys an immutable app image only after migration and candidate validation succeed", () => {
    const script = read("deploy/deploy.sh");
    const common = read("deploy/release-common.sh");

    expect(common).toContain("^sha-[0-9a-f]\\{40\\}$");
    expect(common).toContain("ghcr.io/bloombouquet/dasigap");
    expect(common).toContain('CANDIDATE_CONTAINER="${DASIGAP_CANDIDATE_CONTAINER:-dasigap-candidate}"');
    expect(common).toContain('-p "127.0.0.1:${CANDIDATE_PORT}:3000"');
    expect(common).toContain("/api/health/live");
    expect(common).toContain("/api/health/ready");

    expect(script).toContain('MIGRATION_IMAGE="$REGISTRY_IMAGE:migrate-$IMAGE_TAG"');
    expect(script).toContain("docker run --rm --network host");
    expect(script).toContain("validate_candidate");
    expect(script).toContain("write_previous_image");
    expect(script).toContain("restore_production");
    expect(script).not.toContain("latest");
  });

  it("rolls application code back without attempting a database downgrade", () => {
    const script = read("deploy/rollback.sh");

    expect(script).toContain("previous-image");
    expect(script).toContain("docker compose");
    expect(script).toContain("/api/health");
    expect(script).not.toContain("migrate reset");
    expect(script).not.toContain("migrate resolve");
    expect(script).not.toContain("migrate down");
  });

  it("proxies HTTPS traffic only to the loopback application port", () => {
    const nginx = read("deploy/nginx.conf.example");

    expect(nginx).toContain("proxy_pass http://127.0.0.1:3000");
    expect(nginx).toContain("X-Forwarded-Proto https");
    expect(nginx).toContain("client_max_body_size 11m");
    expect(nginx).toContain("return 301 https://$host$request_uri");
  });

  it("uses pinned SSH host verification for manual production dispatch", () => {
    const workflow = read(".github/workflows/deploy-production.yml");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("DEPLOY_SSH_KEY");
    expect(workflow).toContain("DEPLOY_KNOWN_HOSTS");
    expect(workflow).toContain("StrictHostKeyChecking=yes");
    expect(workflow).toContain("./deploy/deploy.sh");
    expect(workflow).not.toContain("ssh-keyscan");
    expect(workflow).not.toContain("StrictHostKeyChecking=no");
  });
});
