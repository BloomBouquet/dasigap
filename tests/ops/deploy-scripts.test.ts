import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const TARGET_SHA = "2".repeat(40);
const TARGET_TAG = `sha-${TARGET_SHA}`;
const TARGET_IMAGE = `ghcr.io/bloombouquet/dasigap:${TARGET_TAG}`;
const PREVIOUS_IMAGE = `ghcr.io/bloombouquet/dasigap:sha-${"1".repeat(40)}`;

function createHarness(options: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "dasigap-deploy-test-"));
  const bin = join(root, "bin");
  const state = join(root, "state");
  mkdirSync(bin);
  mkdirSync(state);

  const dockerLog = join(root, "docker.log");
  const runtimeImageFile = join(root, "runtime-image");
  const envFile = join(root, "production.env");
  const composeFile = join(root, "compose.yml");
  writeFileSync(dockerLog, "");
  writeFileSync(envFile, "AUTH_MODE=bouquet\n");
  writeFileSync(composeFile, "services: {}\n");
  if (options.CURRENT_IMAGE) writeFileSync(runtimeImageFile, options.CURRENT_IMAGE);

  const docker = `#!/bin/sh
set -eu
printf 'docker %s | image=%s\\n' "$*" "\${DASIGAP_IMAGE:-}" >> "$DOCKER_LOG"

command="\${1:-}"
shift || true

case "$command" in
  compose)
    if [ "\${1:-}" = "version" ]; then exit 0; fi
    if printf '%s\\n' "$*" | grep -q ' up '; then
      printf '%s' "\${DASIGAP_IMAGE:-}" > "$RUNTIME_IMAGE_FILE"
    fi
    exit 0
    ;;
  inspect)
    if [ -r "$RUNTIME_IMAGE_FILE" ]; then cat "$RUNTIME_IMAGE_FILE"; fi
    exit 0
    ;;
  pull)
    if [ -n "\${PULL_FAIL_MATCH:-}" ] && printf '%s' "$*" | grep -q "$PULL_FAIL_MATCH"; then exit 1; fi
    exit 0
    ;;
  run)
    if printf '%s' "$*" | grep -q 'migrate-sha-' && [ "\${MIGRATION_FAIL:-0}" = "1" ]; then exit 1; fi
    exit 0
    ;;
  exec)
    container="\${1:-}"
    if [ "$container" = "dasigap-candidate" ]; then
      [ "\${CANDIDATE_HEALTH:-success}" = "success" ] && exit 0
      exit 1
    fi
    if [ "$container" = "dasigap" ]; then
      current=""
      if [ -r "$RUNTIME_IMAGE_FILE" ]; then current=$(cat "$RUNTIME_IMAGE_FILE"); fi
      if [ "$current" = "\${PREVIOUS_IMAGE:-}" ]; then
        [ "\${RESTORED_HEALTH:-success}" = "success" ] && exit 0
        exit 1
      fi
      [ "\${PRODUCTION_HEALTH:-success}" = "success" ] && exit 0
      exit 1
    fi
    exit 0
    ;;
  rm|stop|logs|logout)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`;
  const dockerPath = join(bin, "docker");
  writeFileSync(dockerPath, docker);
  chmodSync(dockerPath, 0o755);

  const sleepPath = join(bin, "sleep");
  writeFileSync(sleepPath, "#!/bin/sh\nexit 0\n");
  chmodSync(sleepPath, 0o755);

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    DOCKER_LOG: dockerLog,
    RUNTIME_IMAGE_FILE: runtimeImageFile,
    PREVIOUS_IMAGE,
    DASIGAP_ENV_FILE: envFile,
    DASIGAP_STATE_DIR: state,
    DASIGAP_COMPOSE_FILE: composeFile,
    DASIGAP_HEALTH_ATTEMPTS: "2",
    DASIGAP_HEALTH_SLEEP_SECONDS: "0",
    ...options,
  };

  return {
    root,
    state,
    dockerLog,
    runtimeImageFile,
    env,
    log: () => readFileSync(dockerLog, "utf8"),
  };
}

function runDeploy(harness: ReturnType<typeof createHarness>, tag = TARGET_TAG) {
  return spawnSync("sh", [resolve("deploy/deploy.sh"), tag], {
    env: harness.env,
    encoding: "utf8",
  });
}

function productionUpLines(log: string) {
  return log
    .split("\n")
    .filter((line) => line.includes("docker compose") && line.includes(" up ") && line.includes("dasigap"));
}

describe("production deploy state machine", () => {
  it("rejects malformed tags before Docker mutation", () => {
    const harness = createHarness({ CURRENT_IMAGE: PREVIOUS_IMAGE });
    const result = runDeploy(harness, "sha-not-a-commit");

    expect(result.status).toBe(2);
    expect(harness.log()).toBe("");
  });

  it("leaves production untouched when an immutable image pull fails", () => {
    const harness = createHarness({ CURRENT_IMAGE: PREVIOUS_IMAGE, PULL_FAIL_MATCH: TARGET_IMAGE });
    const result = runDeploy(harness);

    expect(result.status).not.toBe(0);
    expect(productionUpLines(harness.log())).toEqual([]);
  });

  it("leaves candidate and production untouched when migration fails", () => {
    const harness = createHarness({ CURRENT_IMAGE: PREVIOUS_IMAGE, MIGRATION_FAIL: "1" });
    const result = runDeploy(harness);
    const log = harness.log();

    expect(result.status).not.toBe(0);
    expect(log).not.toContain("dasigap-candidate");
    expect(productionUpLines(log)).toEqual([]);
  });

  it("does not replace production when candidate health fails", () => {
    const harness = createHarness({ CURRENT_IMAGE: PREVIOUS_IMAGE, CANDIDATE_HEALTH: "fail" });
    const result = runDeploy(harness);
    const log = harness.log();

    expect(result.status).not.toBe(0);
    expect(log).toContain("dasigap-candidate");
    expect(productionUpLines(log)).toEqual([]);
  });

  it("rejects a candidate with the wrong release sha before production replacement", () => {
    const harness = createHarness({ CURRENT_IMAGE: PREVIOUS_IMAGE, CANDIDATE_HEALTH: "wrong-sha" });
    const result = runDeploy(harness);
    const log = harness.log();

    expect(result.status).not.toBe(0);
    expect(log).toContain("dasigap-candidate");
    expect(productionUpLines(log)).toEqual([]);
  });

  it("switches production exactly once after a healthy candidate", () => {
    const harness = createHarness({ CURRENT_IMAGE: PREVIOUS_IMAGE });
    const result = runDeploy(harness);
    const log = harness.log();

    expect(result.status).toBe(0);
    expect(log).toContain("dasigap-candidate");
    expect(productionUpLines(log)).toHaveLength(1);
    expect(productionUpLines(log)[0]).toContain(`image=${TARGET_IMAGE}`);
  });

  it("restores the previous immutable app when local post-switch health fails", () => {
    const harness = createHarness({
      CURRENT_IMAGE: PREVIOUS_IMAGE,
      PRODUCTION_HEALTH: "fail",
      RESTORED_HEALTH: "success",
    });
    const result = runDeploy(harness);
    const ups = productionUpLines(harness.log());

    expect(result.status).not.toBe(0);
    expect(ups.some((line) => line.includes(`image=${TARGET_IMAGE}`))).toBe(true);
    expect(ups.some((line) => line.includes(`image=${PREVIOUS_IMAGE}`))).toBe(true);
  });

  it("does not invent a restore target on first-deploy local failure", () => {
    const harness = createHarness({ PRODUCTION_HEALTH: "fail" });
    const result = runDeploy(harness);
    const log = harness.log();

    expect(result.status).not.toBe(0);
    expect(log).not.toContain(`image=${PREVIOUS_IMAGE}`);
    expect(log).toMatch(/docker (?:rm|stop).*dasigap/);
  });
});
