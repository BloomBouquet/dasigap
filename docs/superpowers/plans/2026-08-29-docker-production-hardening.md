# Docker Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 Docker/GHCR 운영 경로를 유지하면서 release SHA 식별, PostgreSQL/S3 readiness, loopback candidate 검증, 실패 시 application 자동 복구, protected manual rollback을 추가한다.

**Architecture:** 애플리케이션에는 순수 release identity 모듈과 dependency-injected readiness orchestration을 추가한다. S3 readiness는 기존 SigV4 구현을 확장한 authenticated bucket `HEAD`만 수행한다. 배포는 기존 immutable runtime/migrator image를 그대로 사용하되 `deploy/release-common.sh`가 candidate 검증과 exact-SHA health 검증, production switch/restore 공통 동작을 제공하고 `deploy.sh`와 `rollback.sh`는 상태 전이만 조합한다. GitHub Actions는 기존 `Production Image`와 `Deploy Production`을 강화하고 별도 protected rollback workflow를 추가한다.

**Tech Stack:** Next.js 16, TypeScript strict, PostgreSQL, Prisma 6.19.2, custom AWS SigV4 S3-compatible storage, Vitest, Playwright, Docker/Compose, GHCR, GitHub Actions, POSIX `sh`, Nginx HTTPS reverse proxy

**Spec:** `docs/superpowers/specs/2026-08-29-docker-production-hardening-design.md`

## Global Constraints

- 기존 Docker/GHCR 배포를 유일한 production 경로로 유지한다.
- `dasigap/devops-production-release`의 PM2/tar/symlink machinery는 복사하거나 merge하지 않는다.
- production runtime 선택에는 항상 `ghcr.io/bloombouquet/dasigap:sha-<40-lowercase-sha>`만 사용한다. `latest`는 배포 입력으로 사용하지 않는다.
- DB migration은 `migrate-sha-<sha>`에서만 실행하며 자동 downgrade를 만들지 않는다.
- candidate는 `dasigap-candidate`, 기본 host binding `127.0.0.1:3101:3000`으로만 노출한다.
- production은 기존처럼 `127.0.0.1:3000:3000`으로만 노출한다.
- health response와 workflow 로그에 DB/S3 endpoint, bucket, credentials, provider raw errors를 노출하지 않는다.
- `ssh-keyscan`, `StrictHostKeyChecking=no`, server-side `git pull`을 사용하지 않는다.
- 실제 production domain/client ID/credential 값을 repository에 추가하지 않는다.
- 구현은 각 task에서 RED → minimal GREEN → regression 순으로 진행하고 task별 English commit을 남긴다.

---

## File Structure

- `src/health/release.ts`: runtime release SHA 정규화/조회
- `src/health/release.test.ts`: exact lowercase SHA 및 `unknown` fallback 단위 테스트
- `src/health/readiness.ts`: DB/storage readiness orchestration + bounded timeout
- `src/health/readiness.test.ts`: success/reject/throw/timeout 단위 테스트
- `app/api/health/live/route.ts`: process-only liveness + release SHA
- `app/api/health/ready/route.ts`: dependency readiness 200/503 + sanitized body
- `app/api/health/route.ts`: 기존 `{ status: "ok" }` compatibility contract 유지
- `tests/integration/health.test.ts`: compatibility/live/ready HTTP contract 검증
- `src/documents/storage.ts`: SigV4 `HEAD` 및 authenticated bucket readiness probe
- `tests/integration/s3-storage.test.ts`: 실제 MinIO HEAD + non-mutation 검증
- `Dockerfile`: `RELEASE_SHA` build arg → `DASIGAP_RELEASE_SHA`, liveness healthcheck 갱신
- `.github/workflows/production-image.yml`: runtime SHA build arg + exact-SHA smoke
- `deploy/release-common.sh`: immutable tag parsing, candidate lifecycle, health verification, switch/restore 공통 함수
- `deploy/deploy.sh`: pull → migration → candidate → production switch → local restore
- `deploy/rollback.sh`: no-migration candidate → switch → restore
- `deploy/compose.production.yml`: production healthcheck를 `/api/health/live`로 갱신
- `tests/ops/deploy-scripts.test.ts`: stub Docker 기반 state-machine 테스트
- `tests/ops/workflows.test.ts`: production workflows 정적 security contract 테스트
- `vitest.config.ts`: `tests/ops/**/*.test.ts`를 기본 suite에 포함
- `package.json`: focused ops/shell verification scripts
- `.github/workflows/deploy-production.yml`: external HTTPS ready/exact-SHA 검증 + 실패 시 application rollback
- `.github/workflows/rollback-production.yml`: protected manual application-only rollback
- `.github/workflows/ci.yml`: shell syntax + ops tests + existing full gates 유지
- `docs/DEPLOYMENT.md`: candidate/restore/manual rollback 및 external prerequisites 문서화

---

### Task 1: Release Identity and Liveness Contract

**Files:**
- Create: `src/health/release.ts`
- Create: `src/health/release.test.ts`
- Create: `app/api/health/live/route.ts`
- Modify: `tests/integration/health.test.ts`
- Keep compatible: `app/api/health/route.ts`

**Interfaces:**
- Produces: `getReleaseSha(value?: string): string`
- Produces: `GET /api/health/live -> 200 { status: "ok", release }`
- Preserves: `GET /api/health -> 200 { status: "ok" }`

- [ ] **Step 1: Write failing release identity tests**

Create `src/health/release.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { getReleaseSha } from "./release";

describe("release identity", () => {
  it("accepts an exact lowercase 40-character commit SHA", () => {
    const sha = "a".repeat(40);
    expect(getReleaseSha(sha)).toBe(sha);
  });

  it.each([
    undefined,
    "",
    "A".repeat(40),
    "a".repeat(39),
    "a".repeat(41),
    "g".repeat(40),
  ])("falls back to unknown for %s", (value) => {
    expect(getReleaseSha(value)).toBe("unknown");
  });
});
```

- [ ] **Step 2: Extend HTTP tests before routes exist**

Modify `tests/integration/health.test.ts` to keep the exact old compatibility assertion and add a liveness assertion with a stubbed `DASIGAP_RELEASE_SHA`:

```ts
vi.stubEnv("DASIGAP_RELEASE_SHA", "1".repeat(40));
const response = await GET_LIVE();
expect(response.status).toBe(200);
expect(response.headers.get("cache-control")).toBe("no-store");
await expect(response.json()).resolves.toEqual({
  status: "ok",
  release: "1".repeat(40),
});
```

The existing `/api/health` test must continue to assert exactly `{ status: "ok" }`.

- [ ] **Step 3: Verify RED**

Run:

```bash
pnpm vitest run src/health/release.test.ts tests/integration/health.test.ts
```

Expected: FAIL because `src/health/release.ts` and `/api/health/live` do not exist.

- [ ] **Step 4: Implement minimal release identity**

Create `src/health/release.ts`:

```ts
const RELEASE_SHA = /^[0-9a-f]{40}$/;

export function getReleaseSha(value = process.env.DASIGAP_RELEASE_SHA): string {
  return value && RELEASE_SHA.test(value) ? value : "unknown";
}
```

Create `app/api/health/live/route.ts`:

```ts
import { getReleaseSha } from "../../../../src/health/release";

export async function GET() {
  return Response.json(
    { status: "ok", release: getReleaseSha() },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
```

Do not import Prisma or object storage from the live route.

- [ ] **Step 5: Verify GREEN and compatibility**

Run:

```bash
pnpm vitest run src/health/release.test.ts tests/integration/health.test.ts
pnpm typecheck
```

Expected: PASS, including the unchanged exact body of legacy `/api/health`.

- [ ] **Step 6: Commit**

```bash
git add src/health app/api/health/live tests/integration/health.test.ts
git commit -m "feat: add release-aware liveness health"
```

---

### Task 2: PostgreSQL and S3 Readiness

**Files:**
- Create: `src/health/readiness.ts`
- Create: `src/health/readiness.test.ts`
- Create: `app/api/health/ready/route.ts`
- Modify: `src/documents/storage.ts`
- Modify: `tests/integration/health.test.ts`
- Modify: `tests/integration/s3-storage.test.ts`

**Interfaces:**
- Produces: `checkObjectStorageReadiness(signal?: AbortSignal): Promise<void>`
- Produces: `checkReadiness(options?): Promise<boolean>`
- Produces: `GET /api/health/ready -> 200 ready | 503 unavailable`

- [ ] **Step 1: Write failing readiness orchestration tests**

Create `src/health/readiness.test.ts` with injected probes. Required cases:

```ts
await expect(
  checkReadiness({
    databaseProbe: async () => {},
    objectStorageProbe: async () => {},
    timeoutMs: 50,
  }),
).resolves.toBe(true);

await expect(
  checkReadiness({
    databaseProbe: async () => { throw new Error("db secret detail"); },
    objectStorageProbe: async () => {},
    timeoutMs: 50,
  }),
).resolves.toBe(false);

await expect(
  checkReadiness({
    databaseProbe: () => { throw new Error("sync db failure"); },
    objectStorageProbe: async () => {},
    timeoutMs: 50,
  }),
).resolves.toBe(false);

await expect(
  checkReadiness({
    databaseProbe: async () => new Promise<void>(() => {}),
    objectStorageProbe: async () => {},
    timeoutMs: 10,
  }),
).resolves.toBe(false);
```

Also cover rejected/timeout storage probes.

- [ ] **Step 2: Add failing ready-route tests**

In `tests/integration/health.test.ts`, mock `checkReadiness` at module boundary and assert:

- `true` -> HTTP 200 + `{ status: "ready", release: expectedSha }`
- `false` -> HTTP 503 + `{ status: "unavailable", release: expectedSha }`
- both responses are `no-store`
- serialized failure body does not contain `database`, `storage`, endpoint strings, bucket names, or injected error text.

- [ ] **Step 3: Add failing MinIO HEAD contract**

Extend `tests/integration/s3-storage.test.ts`:

1. Create a random nonexistent key.
2. Generate a signed GET URL and assert GET is 404.
3. Call `checkObjectStorageReadiness()`.
4. Reuse the signed GET URL and assert it remains 404.
5. Then execute the existing PUT → signed GET → DELETE lifecycle to prove no regression.

This proves the readiness call did not create the sentinel object.

- [ ] **Step 4: Verify RED**

Run:

```bash
pnpm vitest run src/health/readiness.test.ts tests/integration/health.test.ts
RUN_S3_INTEGRATION=1 pnpm vitest run tests/integration/s3-storage.test.ts
```

The focused S3 command is expected to require the CI MinIO service; locally, the first command must still be RED because readiness exports/routes are missing.

- [ ] **Step 5: Extend SigV4 request support minimally**

In `src/documents/storage.ts`:

1. Extend the signed request method type from:

```ts
method: "PUT" | "DELETE"
```

to:

```ts
method: "PUT" | "DELETE" | "HEAD"
```

2. Add a bucket-root URL helper that preserves any endpoint base path and appends only the encoded bucket name:

```ts
function bucketUrl(config: StorageConfiguration) {
  const url = new URL(config.endpoint.toString());
  const base = url.pathname.replace(/\/$/, "");
  url.pathname = `${base}/${encodeURIComponent(config.bucket)}`;
  return url;
}
```

3. Add the exported probe:

```ts
export async function checkObjectStorageReadiness(signal?: AbortSignal): Promise<void> {
  const config = requireConfiguration();
  const url = bucketUrl(config);
  const empty = new Uint8Array();
  const headers = signedHeadersForRequest("HEAD", url, empty);
  const response = await fetch(url, { method: "HEAD", headers, signal });
  if (!response.ok) throw new ObjectStorageOperationError();
}
```

Do not add PUT/DELETE fallback behavior to readiness.

- [ ] **Step 6: Implement bounded readiness orchestration**

Create `src/health/readiness.ts` with these concrete interfaces:

```ts
import { prisma } from "../db/prisma";
import { checkObjectStorageReadiness } from "../documents/storage";

export type ReadinessOptions = {
  databaseProbe?: () => Promise<void>;
  objectStorageProbe?: () => Promise<void>;
  timeoutMs?: number;
};

async function databaseProbe() {
  await prisma.$queryRaw`SELECT 1`;
}
```

Use a helper that executes each probe through `Promise.resolve().then(probe)` so synchronous throws are caught, races it against a timeout, clears its timer in `finally`, and returns `false` on any error. `checkReadiness` runs DB and storage checks in parallel and returns `true` only when both succeed. Default timeout: `1500ms`.

- [ ] **Step 7: Implement sanitized readiness route**

Create `app/api/health/ready/route.ts`:

```ts
import { checkReadiness } from "../../../../src/health/readiness";
import { getReleaseSha } from "../../../../src/health/release";

export async function GET() {
  const ready = await checkReadiness();
  return Response.json(
    {
      status: ready ? "ready" : "unavailable",
      release: getReleaseSha(),
    },
    {
      status: ready ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
```

No raw exception is included in the body.

- [ ] **Step 8: Verify GREEN with real MinIO**

Run in CI-compatible environment:

```bash
pnpm vitest run src/health/readiness.test.ts tests/integration/health.test.ts
RUN_S3_INTEGRATION=1 pnpm vitest run tests/integration/s3-storage.test.ts
pnpm typecheck
```

Expected: readiness units/routes PASS; actual MinIO authenticated bucket HEAD PASS; sentinel object remains absent.

- [ ] **Step 9: Commit**

```bash
git add src/health src/documents/storage.ts app/api/health/ready tests/integration/health.test.ts tests/integration/s3-storage.test.ts
git commit -m "feat: add dependency readiness health checks"
```

---

### Task 3: Immutable Runtime SHA in Docker Images

**Files:**
- Modify: `Dockerfile`
- Modify: `.github/workflows/production-image.yml`
- Modify: `deploy/compose.production.yml`
- Create: `tests/ops/workflows.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Docker build arg: `RELEASE_SHA`
- Runtime env: `DASIGAP_RELEASE_SHA`
- Docker/Compose liveness: `/api/health/live`

- [ ] **Step 1: Add failing workflow/image static tests**

Create `tests/ops/workflows.test.ts`. Read `Dockerfile`, `.github/workflows/production-image.yml`, and `deploy/compose.production.yml` as strings and assert:

```ts
expect(dockerfile).toContain("ARG RELEASE_SHA=unknown");
expect(dockerfile).toContain("ENV DASIGAP_RELEASE_SHA=$RELEASE_SHA");
expect(dockerfile).toContain("/api/health/live");
expect(imageWorkflow).toContain("RELEASE_SHA=${{ github.sha }}");
expect(imageWorkflow).toContain("/api/health/live");
expect(imageWorkflow).toContain("release");
expect(compose).toContain("127.0.0.1:3000:3000");
expect(compose).toContain("/api/health/live");
expect(compose).not.toContain('"0.0.0.0:3000:3000"');
```

Extend `vitest.config.ts` include list to add `tests/ops/**/*.test.ts`, but do not implement the expected Docker/workflow changes yet.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run tests/ops/workflows.test.ts
```

Expected: FAIL on missing `RELEASE_SHA` build arg/env and old `/api/health` checks.

- [ ] **Step 3: Harden Dockerfile runtime identity**

In the final `runner` stage:

```dockerfile
ARG RELEASE_SHA=unknown
ENV DASIGAP_RELEASE_SHA=$RELEASE_SHA
```

Change the Docker `HEALTHCHECK` URL from `/api/health` to `/api/health/live`.

Do not add credentials or build-time production env values.

- [ ] **Step 4: Pass exact SHA from Production Image workflow**

For both runtime build actions (`load: true` smoke and `push: true` publish), add:

```yaml
build-args: |
  RELEASE_SHA=${{ github.sha }}
```

Leave the migrator target unchanged; it does not need runtime health identity.

Change runtime smoke verification to parse `/api/health/live` with Node instead of substring-only grep. The loop must require both `status === "ok"` and `release === process.env.EXPECTED_SHA`:

```bash
body="$(curl -fsS http://127.0.0.1:3000/api/health/live || true)"
printf '%s' "$body" | EXPECTED_SHA="${{ github.sha }}" node -e '
let body="";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => body += chunk);
process.stdin.on("end", () => {
  try {
    const value = JSON.parse(body);
    process.exit(value.status === "ok" && value.release === process.env.EXPECTED_SHA ? 0 : 1);
  } catch { process.exit(1); }
});
'
```

- [ ] **Step 5: Update Compose healthcheck**

Use `/api/health/live` while preserving `127.0.0.1:3000:3000`.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
pnpm vitest run tests/ops/workflows.test.ts
pnpm typecheck
DASIGAP_IMAGE=ghcr.io/bloombouquet/dasigap:sha-0000000000000000000000000000000000000000 \
DASIGAP_ENV_FILE="$PWD/deploy/.env.production.example" \
  docker compose -f deploy/compose.production.yml config >/dev/null
```

Then confirm the branch `Production Image` workflow builds the smoke runtime with its own exact branch SHA and passes `/api/health/live` identity validation.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .github/workflows/production-image.yml deploy/compose.production.yml tests/ops/workflows.test.ts vitest.config.ts
git commit -m "feat: bind production images to release sha"
```

---

### Task 4: Candidate-Safe Deployment and Local Automatic Restore

**Files:**
- Create: `deploy/release-common.sh`
- Rewrite: `deploy/deploy.sh`
- Create: `tests/ops/deploy-scripts.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Shared shell functions for immutable image parsing, candidate validation, production health verification, state writing, and restore
- `deploy/deploy.sh sha-<40>` performs migration before candidate and production switch only after candidate success

- [ ] **Step 1: Add focused ops scripts to package/CI test surface**

Add scripts:

```json
"test:ops": "vitest run tests/ops",
"check:deploy": "sh -n deploy/release-common.sh deploy/deploy.sh deploy/rollback.sh"
```

In CI, replace individual `sh -n` lines with `pnpm check:deploy`. Keep Compose config validation.

- [ ] **Step 2: Write failing deployment state-machine tests**

Create `tests/ops/deploy-scripts.test.ts` using `node:fs/promises`, `node:child_process`, temporary directories, and a stub `docker` executable injected at the front of `PATH`.

The stub must append all arguments to `$DOCKER_LOG` and read deterministic response knobs from env. Tests must cover at least:

1. malformed image tag returns exit 2 before any Docker mutation;
2. `docker pull` failure leaves `compose up` absent from log;
3. migrator `docker run` failure leaves candidate/production absent;
4. candidate health failure leaves production `compose up` absent;
5. candidate returns HTTP-success semantics but wrong SHA -> production untouched;
6. successful candidate permits exactly one production recreate;
7. production local health failure recreates the prior immutable image and script still exits nonzero;
8. first-deploy local failure has no previous-image restore and removes/stops failed production.

Use an initial production image such as:

```text
ghcr.io/bloombouquet/dasigap:sha-1111111111111111111111111111111111111111
```

and target:

```text
ghcr.io/bloombouquet/dasigap:sha-2222222222222222222222222222222222222222
```

- [ ] **Step 3: Verify RED against current deploy.sh**

Run:

```bash
pnpm vitest run tests/ops/deploy-scripts.test.ts
```

Expected: FAIL because current script has no candidate phase and no automatic previous-image restore.

- [ ] **Step 4: Implement `deploy/release-common.sh`**

Use POSIX `sh` only (`#!/bin/sh`, `set -eu`). Centralize constants:

```sh
REGISTRY_IMAGE='ghcr.io/bloombouquet/dasigap'
PRODUCTION_CONTAINER='dasigap'
CANDIDATE_CONTAINER='dasigap-candidate'
CANDIDATE_PORT="${DASIGAP_CANDIDATE_PORT:-3101}"
HEALTH_ATTEMPTS="${DASIGAP_HEALTH_ATTEMPTS:-30}"
HEALTH_SLEEP_SECONDS="${DASIGAP_HEALTH_SLEEP_SECONDS:-1}"
```

Implement these concrete functions:

```sh
require_image_tag()       # sha- + 40 lowercase hex
sha_from_image_tag()      # print raw 40-char SHA only
require_immutable_image() # full ghcr.io/...:sha-<sha>
current_production_image()
write_previous_image()    # chmod 600; remove stale state when no valid prior image
remove_candidate()
verify_container_health() # live + ready + exact release SHA
validate_candidate()      # docker run -d --name dasigap-candidate --env-file ... -p 127.0.0.1:${port}:3000
recreate_production()     # existing Compose service
restore_production()      # recreate old immutable image and verify it
```

`verify_container_health` must use the Node binary already inside the runtime container, not require host `jq` or Node. Each attempt executes:

```sh
docker exec "$container" node -e '
const expected = process.argv[1];
(async () => {
  for (const [path, status] of [["/api/health/live", "ok"], ["/api/health/ready", "ready"]]) {
    const response = await fetch("http://127.0.0.1:3000" + path, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok || body.status !== status || body.release !== expected) process.exit(1);
  }
})().catch(() => process.exit(1));
' "$expected_sha"
```

Do not print the response body on failure.

`validate_candidate` must always remove stale candidate first and remove the candidate on both success and failure. The port binding must be exactly loopback:

```sh
-p "127.0.0.1:${CANDIDATE_PORT}:3000"
```

- [ ] **Step 5: Rewrite deploy state order**

`deploy/deploy.sh` order must be:

```text
validate tag/env/docker
→ resolve APP_IMAGE + MIGRATION_IMAGE + target SHA
→ capture current immutable production image in memory
→ pull migrator + runtime
→ run migrator exactly once
→ validate runtime candidate
→ write/remove previous-image state based on captured current image
→ recreate production with target image
→ verify production live + ready + exact SHA
→ success
```

If production verification fails:

- if a captured previous immutable image exists, call `restore_production` and then exit nonzero;
- otherwise stop/remove failed first-deploy application and exit nonzero;
- never run migrator during restoration.

Candidate or migration failure must happen before state-changing production Compose commands.

- [ ] **Step 6: Verify GREEN and shell syntax**

Run:

```bash
pnpm vitest run tests/ops/deploy-scripts.test.ts
pnpm check:deploy
pnpm test
```

Expected: all deployment cases PASS and existing application tests remain green.

- [ ] **Step 7: Commit**

```bash
git add deploy/release-common.sh deploy/deploy.sh tests/ops/deploy-scripts.test.ts package.json .github/workflows/ci.yml
git commit -m "feat: add candidate-safe production deployment"
```

---

### Task 5: Application-Only Rollback and Protected Production Workflows

**Files:**
- Rewrite: `deploy/rollback.sh`
- Modify: `tests/ops/deploy-scripts.test.ts`
- Modify: `tests/ops/workflows.test.ts`
- Modify: `.github/workflows/deploy-production.yml`
- Create: `.github/workflows/rollback-production.yml`

**Interfaces:**
- `deploy/rollback.sh [sha-<40>]` performs no migrations
- Deploy and rollback workflows share `dasigap-production-deploy` concurrency and `environment: production`
- Production environment variable: `vars.PRODUCTION_BASE_URL`

- [ ] **Step 1: Add failing rollback script tests**

Extend `tests/ops/deploy-scripts.test.ts` to assert:

1. rollback target candidate failure leaves current production image untouched;
2. successful target candidate permits switch;
3. rollback Docker log contains no `migrate-sha-`, `prisma`, or migrator `docker run`;
4. rollback post-switch health failure restores the immutable image that was current at rollback start;
5. rollback with no explicit tag reads `previous-image`, validates it as immutable, and still candidate-tests it before switch.

- [ ] **Step 2: Add failing workflow security tests**

Extend `tests/ops/workflows.test.ts` to read both production workflows and assert:

```ts
expect(deploy).toContain("environment: production");
expect(rollback).toContain("environment: production");
expect(deploy).toContain("group: dasigap-production-deploy");
expect(rollback).toContain("group: dasigap-production-deploy");
expect(deploy).toContain("DEPLOY_KNOWN_HOSTS");
expect(rollback).toContain("DEPLOY_KNOWN_HOSTS");
expect(deploy).toContain("StrictHostKeyChecking=yes");
expect(rollback).toContain("StrictHostKeyChecking=yes");
expect(deploy).toContain("PRODUCTION_BASE_URL");
expect(rollback).toContain("PRODUCTION_BASE_URL");
expect(`${deploy}\n${rollback}`).not.toContain("ssh-keyscan");
expect(`${deploy}\n${rollback}`).not.toContain("StrictHostKeyChecking=no");
expect(`${deploy}\n${rollback}`).not.toContain("git pull");
expect(rollback).not.toContain("migrate-sha-");
expect(rollback).not.toContain("prisma migrate");
```

Also require both workflows to validate `^[0-9a-f]{40}$` input and `git merge-base --is-ancestor` against `origin/main`.

- [ ] **Step 3: Verify RED**

Run:

```bash
pnpm vitest run tests/ops/deploy-scripts.test.ts tests/ops/workflows.test.ts
```

Expected: FAIL because rollback currently switches before candidate, deploy has no external readiness, and rollback workflow does not exist.

- [ ] **Step 4: Rewrite rollback.sh using common candidate boundary**

The rollback order must be:

```text
resolve explicit target or previous-image
→ require immutable app image and extract expected SHA
→ validate env/docker
→ capture current immutable production image
→ pull target runtime only
→ validate candidate target
→ record captured current image as previous-image (or clear stale state)
→ recreate production target
→ verify live + ready + exact target SHA
→ success
```

On local post-switch failure, restore the image captured at rollback start and exit nonzero. Never reference `migrate-sha-` or run Prisma.

- [ ] **Step 5: Harden Deploy Production external verification**

Keep the current main-ancestry and pinned SSH setup. Add:

```yaml
PRODUCTION_BASE_URL: ${{ vars.PRODUCTION_BASE_URL }}
```

Validate it before SSH using Node:

```bash
node -e '
const url = new URL(process.env.PRODUCTION_BASE_URL || "");
if (url.protocol !== "https:" || url.username || url.password || url.hash) process.exit(1);
'
```

Stage `deploy/release-common.sh` along with compose/deploy/rollback scripts.

After remote `deploy.sh` succeeds, check `${PRODUCTION_BASE_URL%/}/api/health/ready` and require:

```json
{ "status": "ready", "release": "<IMAGE_SHA>" }
```

Parse JSON with Node, not `grep`.

If external verification fails:

1. invoke `./deploy/rollback.sh` with no explicit target so the server uses the just-recorded `previous-image`;
2. best-effort verify the restored external endpoint against the SHA encoded in the restored immutable image/state when available;
3. always exit nonzero for the failed deployment even if restoration succeeds.

For a first deployment with no previous state, do not fabricate a rollback target; stop/remove the failed target via the server script path and fail.

- [ ] **Step 6: Create protected manual rollback workflow**

Create `.github/workflows/rollback-production.yml`:

- name: `Rollback Production`
- `workflow_dispatch` input `image_sha` full 40-char SHA
- `permissions: contents: read, packages: read`
- concurrency `group: dasigap-production-deploy`, `cancel-in-progress: false`
- job `if: github.ref == 'refs/heads/main'`
- `environment: production`
- same `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `GHCR_TOKEN`
- `PRODUCTION_BASE_URL: ${{ vars.PRODUCTION_BASE_URL }}`
- validate lowercase SHA and main ancestry
- configure pinned known_hosts exactly like deploy workflow
- stage `release-common.sh`, compose and rollback script; no server Git operations
- GHCR login through stdin and best-effort logout trap
- remote `./deploy/rollback.sh "sha-$IMAGE_SHA"`
- external `/api/health/ready` must return `ready` and exact target SHA
- if external verification fails, call remote `./deploy/rollback.sh` with no argument to restore the image that was current at rollback start, then fail workflow.

The workflow source must contain no migration invocation.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
pnpm vitest run tests/ops/deploy-scripts.test.ts tests/ops/workflows.test.ts
pnpm check:deploy
pnpm test
```

Expected: all script state transitions and workflow security assertions PASS.

- [ ] **Step 8: Commit**

```bash
git add deploy/rollback.sh .github/workflows/deploy-production.yml .github/workflows/rollback-production.yml tests/ops
git commit -m "feat: add protected production rollback"
```

---

### Task 6: Release Documentation and Full Verification Gate

**Files:**
- Modify: `docs/DEPLOYMENT.md`
- Modify if verification requires: `.github/workflows/ci.yml`, `deploy/.env.production.example`, test/support files only

**Interfaces:**
- Documents repository automation readiness separately from real production rollout state
- Establishes final CI/review evidence before PR

- [ ] **Step 1: Update deployment guide to match implemented state machine**

Revise existing `docs/DEPLOYMENT.md`; do not create a second operations guide. Document:

1. immutable runtime/migrator image naming;
2. `DASIGAP_RELEASE_SHA` is baked from `RELEASE_SHA` and checked by health endpoints;
3. `/api/health/live` vs `/api/health/ready`, with legacy `/api/health` compatibility noted;
4. deploy order: pull → migrate → loopback candidate → production switch → local verify → external HTTPS verify;
5. candidate uses `127.0.0.1:3101` and production uses `127.0.0.1:3000`;
6. migration/candidate failures leave current application unchanged;
7. post-switch or external failure restores the previous application image when available;
8. first-deploy failure has no fake rollback target;
9. manual rollback does not run migrations and assumes expand/contract schema compatibility;
10. GitHub `production` environment configuration needs `vars.PRODUCTION_BASE_URL` plus existing SSH secrets;
11. actual host/TLS/Postgres/S3/BloomBouquet OAuth setup remains an external rollout prerequisite and must not be marked completed solely because code merged.

- [ ] **Step 2: Run all deterministic source verification**

Run:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm prisma validate
pnpm typecheck
pnpm test
pnpm check:deploy
DASIGAP_IMAGE=ghcr.io/bloombouquet/dasigap:sha-0000000000000000000000000000000000000000 \
DASIGAP_ENV_FILE="$PWD/deploy/.env.production.example" \
  docker compose -f deploy/compose.production.yml config >/dev/null
pnpm build
pnpm test:e2e
```

Expected: all PASS.

- [ ] **Step 3: Run real MinIO readiness integration**

Start the same pinned MinIO server/client versions used by `.github/workflows/ci.yml`, create `dasigap-ci`, then run:

```bash
RUN_S3_INTEGRATION=1 \
OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000 \
OBJECT_STORAGE_REGION=us-east-1 \
OBJECT_STORAGE_BUCKET=dasigap-ci \
OBJECT_STORAGE_ACCESS_KEY_ID=dasigap-ci \
OBJECT_STORAGE_SECRET_ACCESS_KEY=dasigap-ci-secret \
  pnpm exec vitest run tests/integration/s3-storage.test.ts
```

Expected: authenticated bucket HEAD and existing signed URL lifecycle PASS.

- [ ] **Step 4: Verify Production Image workflow**

Confirm the workflow run for the exact branch HEAD passes:

- runtime image build with `RELEASE_SHA=<head sha>`;
- `/api/health/live` exact-SHA smoke;
- migrator PostgreSQL smoke;
- no publish job on non-main branch.

Do not claim GHCR production publish until the commit is actually on `main`.

- [ ] **Step 5: Security review**

Review final diff for:

- no production secrets or `.env` values committed;
- no `ssh-keyscan`, `StrictHostKeyChecking=no`, server `git pull`;
- no production use of `latest`;
- no candidate `0.0.0.0` binding;
- no raw readiness errors in HTTP bodies;
- rollback source/workflow contains no migrator execution;
- deploy migration happens before candidate and production mutation;
- candidate failure paths never call production Compose replacement;
- external failure returns workflow failure after restoration.

- [ ] **Step 6: Code review against approved spec**

Map every failure row in the spec to a test and implementation branch. Specifically verify:

```text
invalid SHA -> pre-SSH failure
pull failure -> prod unchanged
migration failure -> prod unchanged
candidate live/ready/wrong SHA -> prod unchanged
local post-switch failure -> previous app restored
external failure -> previous app restored + workflow failed
rollback candidate failure -> current unchanged
rollback post-switch failure -> original app restored
```

- [ ] **Step 7: Commit documentation/verification-only corrections if needed**

Use an English commit scoped to the actual change, for example:

```bash
git add docs/DEPLOYMENT.md .github/workflows/ci.yml deploy/.env.production.example
git commit -m "docs: finalize production deployment runbook"
```

Do not create an empty commit when no changes are required.

- [ ] **Step 8: Open PR only after fresh HEAD verification**

Before PR creation, re-check that the branch is not behind `main`. If `main` advanced, integrate/rebase onto the latest `main`, rerun the relevant full gates, then open the PR.

Required PR title:

```text
ci : Docker 운영 배포 안정성 강화
```

Required PR body shape:

```markdown
# ✨ PR 내용

## 📝 코드 변경 사항
- release SHA 기반 live/ready health와 PostgreSQL/S3 readiness를 추가했습니다.
- Docker candidate 검증과 production 실패 시 application 자동 복구를 추가했습니다.
- protected deploy/rollback workflow를 exact SHA와 pinned SSH 기준으로 강화했습니다.

## 💡 변경 이유
- 새 이미지가 실제 의존성과 release identity를 만족하기 전에 production 트래픽으로 교체되는 위험을 줄이기 위해 변경했습니다.
- 배포 실패 시 DB를 역마이그레이션하지 않으면서 이전 애플리케이션으로 안전하게 복귀할 수 있도록 했습니다.

## 🛠️ 구현 방법
- immutable GHCR runtime/migrator 이미지는 유지하고 runtime에 exact commit SHA를 주입했습니다.
- migration 이후 loopback candidate의 live/ready와 SHA를 검증한 뒤 production을 교체합니다.
- local/external verification 실패 시 기록된 이전 immutable application image를 복원합니다.

## 📌 영향 범위
- production Docker image health contract
- production deploy/rollback scripts
- GitHub Actions production workflows
- PostgreSQL/S3 readiness probe

## ✅ 테스트
- pnpm typecheck
- pnpm test
- 실제 MinIO integration
- pnpm build
- pnpm test:e2e
- Production Image smoke

**테스트 결과 / 참고 사항**
- 최종 HEAD CI와 Production Image workflow 결과를 반영합니다.
- DB migration은 자동 downgrade하지 않으며 실제 production rollout은 별도 환경 설정이 필요합니다.

## 🌿 반영 브랜치
- main
```

---

## Self-review

- **Spec coverage:** release identity, DB/S3 readiness, immutable image SHA, migration-first candidate validation, local restore, external restore, manual no-migration rollback, loopback-only networking, pinned SSH, documentation state are each mapped to Tasks 1-6.
- **Placeholder scan:** no TBD/TODO or unspecified implementation decisions remain. External values such as real production URL/client credentials are intentionally environment prerequisites rather than implementation placeholders.
- **Type/interface consistency:** Docker build arg is `RELEASE_SHA`; runtime env is `DASIGAP_RELEASE_SHA`; production input is raw 40-char `image_sha`; server script tag form is `sha-<40>`; runtime image is `:sha-<40>`; migrator image is `:migrate-sha-<40>`.
- **Health consistency:** legacy `/api/health` remains exact compatibility liveness; all new Docker/deploy verification uses `/api/health/live` and `/api/health/ready` with exact release SHA.
- **Failure consistency:** migrations occur before candidate; candidate failure cannot mutate production; post-switch restoration never executes a migration; workflow remains failed even when restore succeeds.
- **Scope:** no PM2/tar deployment, orchestration platform, automatic DB downgrade, real production credential provisioning, or unrelated application feature work is included.
