# Docker Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 Docker/GHCR 운영 경로를 유지하면서 release SHA 식별, PostgreSQL/S3 readiness, loopback candidate 검증, 실패 시 application 자동 복구, protected manual rollback을 추가한다.

**Architecture:** 애플리케이션에는 순수 release identity 모듈과 dependency-injected readiness orchestration을 추가한다. S3 readiness는 기존 SigV4 구현을 확장한 authenticated bucket `HEAD`만 수행한다. 배포는 기존 immutable runtime/migrator image를 유지하되 `deploy/release-common.sh`가 candidate 검증, exact-SHA health 검증, production switch/restore를 공통 제공하고 `deploy.sh`와 `rollback.sh`는 상태 전이만 조합한다. GitHub Actions는 기존 `Production Image`와 `Deploy Production`을 강화하고 별도 protected rollback workflow를 추가한다.

**Tech Stack:** Next.js 16, TypeScript strict, PostgreSQL, Prisma 6.19.2, custom AWS SigV4 S3-compatible storage, Vitest, Playwright, Docker/Compose, GHCR, GitHub Actions, POSIX `sh`, Nginx HTTPS reverse proxy

**Spec:** `docs/superpowers/specs/2026-08-29-docker-production-hardening-design.md`

## Global Constraints

- 기존 Docker/GHCR 배포를 유일한 production 경로로 유지한다.
- `dasigap/devops-production-release`의 PM2/tar/symlink machinery는 복사하거나 merge하지 않는다.
- production runtime은 `ghcr.io/bloombouquet/dasigap:sha-<40-lowercase-sha>`만 선택한다. `latest`는 배포 입력으로 사용하지 않는다.
- DB migration은 `migrate-sha-<sha>`에서만 실행하고 자동 downgrade를 만들지 않는다.
- candidate는 `dasigap-candidate`, 기본 binding `127.0.0.1:3101:3000`으로만 노출한다.
- production은 기존 `127.0.0.1:3000:3000`만 유지한다.
- health/workflow 로그에 DB/S3 endpoint, bucket, credentials, provider raw errors를 노출하지 않는다.
- `ssh-keyscan`, `StrictHostKeyChecking=no`, server-side `git pull`을 사용하지 않는다.
- 실제 production domain/client ID/credential은 repository에 추가하지 않는다.
- 각 task는 RED → minimal GREEN → regression → English commit 순서로 진행한다.

---

## File Structure

- `src/health/release.ts`, `src/health/release.test.ts`: runtime release SHA
- `src/health/readiness.ts`, `src/health/readiness.test.ts`: bounded DB/storage readiness
- `app/api/health/live/route.ts`: process liveness + SHA
- `app/api/health/ready/route.ts`: dependency readiness + SHA
- `app/api/health/route.ts`: 기존 `{ status: "ok" }` compatibility 유지
- `tests/integration/health.test.ts`: HTTP health contract
- `src/documents/storage.ts`: SigV4 `HEAD` bucket probe
- `tests/integration/s3-storage.test.ts`: 실제 MinIO non-mutating HEAD
- `Dockerfile`, `.github/workflows/production-image.yml`: build-time release identity
- `deploy/release-common.sh`: immutable image/candidate/health/restore primitives
- `deploy/deploy.sh`: migration-first candidate-safe deploy
- `deploy/rollback.sh`: candidate-safe no-migration rollback + workflow recovery mode
- `deploy/compose.production.yml`: production liveness healthcheck
- `tests/ops/deploy-scripts.test.ts`: stub-Docker state machine
- `tests/ops/workflows.test.ts`: workflow/static security contracts
- `vitest.config.ts`, `package.json`, `.github/workflows/ci.yml`: ops tests/syntax gates
- `.github/workflows/deploy-production.yml`: external HTTPS exact-SHA verification
- `.github/workflows/rollback-production.yml`: protected manual rollback
- `docs/DEPLOYMENT.md`: final runbook

---

### Task 1: Release Identity and Liveness Contract

**Files:**
- Create: `src/health/release.ts`
- Create: `src/health/release.test.ts`
- Create: `app/api/health/live/route.ts`
- Modify: `tests/integration/health.test.ts`
- Keep compatible: `app/api/health/route.ts`

**Interfaces:** `getReleaseSha(value?: string): string`, `GET /api/health/live`, existing `GET /api/health`.

- [ ] **Step 1: Write failing release identity tests**

```ts
import { describe, expect, it } from "vitest";
import { getReleaseSha } from "./release";

describe("release identity", () => {
  it("accepts exact lowercase sha", () => {
    const sha = "a".repeat(40);
    expect(getReleaseSha(sha)).toBe(sha);
  });

  it.each([undefined, "", "A".repeat(40), "a".repeat(39), "a".repeat(41), "g".repeat(40)])(
    "uses unknown for invalid value %s",
    (value) => expect(getReleaseSha(value)).toBe("unknown"),
  );
});
```

- [ ] **Step 2: Add failing live-route HTTP assertion**

Keep the current legacy test asserting exactly `{ status: "ok" }`. Add a new live test with `DASIGAP_RELEASE_SHA="1".repeat(40)` expecting 200, `cache-control: no-store`, and:

```ts
{ status: "ok", release: "1".repeat(40) }
```

- [ ] **Step 3: Verify RED**

```bash
pnpm vitest run src/health/release.test.ts tests/integration/health.test.ts
```

Expected: missing release module/live route failure.

- [ ] **Step 4: Implement minimal release identity and live route**

`src/health/release.ts`:

```ts
const RELEASE_SHA = /^[0-9a-f]{40}$/;

export function getReleaseSha(value = process.env.DASIGAP_RELEASE_SHA): string {
  return value && RELEASE_SHA.test(value) ? value : "unknown";
}
```

`app/api/health/live/route.ts`:

```ts
import { getReleaseSha } from "../../../../src/health/release";

export async function GET() {
  return Response.json(
    { status: "ok", release: getReleaseSha() },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
```

The live route must not import Prisma/storage.

- [ ] **Step 5: Verify GREEN**

```bash
pnpm vitest run src/health/release.test.ts tests/integration/health.test.ts
pnpm typecheck
```

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

**Interfaces:** `checkObjectStorageReadiness(signal?: AbortSignal): Promise<void>`, `checkReadiness(options?): Promise<boolean>`, `GET /api/health/ready`.

- [ ] **Step 1: Write failing readiness orchestration tests**

Test injected DB/storage probes for: both success, async rejection, synchronous throw, DB timeout, storage timeout. Example:

```ts
await expect(checkReadiness({
  databaseProbe: async () => {},
  objectStorageProbe: async () => {},
  timeoutMs: 50,
})).resolves.toBe(true);

await expect(checkReadiness({
  databaseProbe: () => { throw new Error("db secret detail"); },
  objectStorageProbe: async () => {},
  timeoutMs: 50,
})).resolves.toBe(false);

await expect(checkReadiness({
  databaseProbe: async () => new Promise<void>(() => {}),
  objectStorageProbe: async () => {},
  timeoutMs: 10,
})).resolves.toBe(false);
```

- [ ] **Step 2: Add failing ready-route tests**

Use a dependency-injected route helper instead of fragile module-hoisted mocks. `app/api/health/ready/route.ts` should export:

```ts
export async function buildReadyResponse(check = checkReadiness) { /* response */ }
export async function GET() { return buildReadyResponse(); }
```

Test `buildReadyResponse(async () => true)` => 200/`ready`, and `false` => 503/`unavailable`, both with exact release SHA and `no-store`. Failure body must not contain dependency names, endpoint/bucket values, or raw error text.

- [ ] **Step 3: Add failing real-MinIO HEAD contract**

Extend `tests/integration/s3-storage.test.ts`:

1. generate a random nonexistent key and signed GET URL;
2. assert GET 404;
3. call `checkObjectStorageReadiness()`;
4. assert the same GET remains 404;
5. run the existing PUT → signed GET → DELETE lifecycle.

- [ ] **Step 4: Verify RED**

```bash
pnpm vitest run src/health/readiness.test.ts tests/integration/health.test.ts
```

The MinIO-focused test remains for CI where MinIO is started.

- [ ] **Step 5: Extend SigV4 to authenticated bucket HEAD**

Change request method union to:

```ts
method: "PUT" | "DELETE" | "HEAD"
```

Add:

```ts
function bucketUrl(config: StorageConfiguration) {
  const url = new URL(config.endpoint.toString());
  const base = url.pathname.replace(/\/$/, "");
  url.pathname = `${base}/${encodeURIComponent(config.bucket)}`;
  return url;
}

export async function checkObjectStorageReadiness(signal?: AbortSignal): Promise<void> {
  const config = requireConfiguration();
  const url = bucketUrl(config);
  const empty = new Uint8Array();
  const headers = signedHeadersForRequest("HEAD", url, empty);
  const response = await fetch(url, { method: "HEAD", headers, signal });
  if (!response.ok) throw new ObjectStorageOperationError();
}
```

No PUT/DELETE fallback is allowed.

- [ ] **Step 6: Implement bounded readiness orchestration**

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

Implement a helper using `Promise.resolve().then(probe)` plus `Promise.race` timeout and timer cleanup. Default timeout is `1500ms`. Run DB/storage in parallel; any failure returns `false`, never throws raw dependency errors through the route.

- [ ] **Step 7: Implement sanitized route**

`buildReadyResponse` returns only:

```ts
{
  status: ready ? "ready" : "unavailable",
  release: getReleaseSha(),
}
```

with HTTP 200/503 and `cache-control: no-store`.

- [ ] **Step 8: Verify GREEN including MinIO**

```bash
pnpm vitest run src/health/readiness.test.ts tests/integration/health.test.ts
RUN_S3_INTEGRATION=1 pnpm vitest run tests/integration/s3-storage.test.ts
pnpm typecheck
```

The MinIO command is run in the existing CI MinIO environment.

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

- [ ] **Step 1: Add failing static image/workflow tests**

Add `tests/ops/**/*.test.ts` to Vitest include, then assert:

```ts
expect(dockerfile).toContain("ARG RELEASE_SHA=unknown");
expect(dockerfile).toContain("ENV DASIGAP_RELEASE_SHA=$RELEASE_SHA");
expect(dockerfile).toContain("/api/health/live");
expect(imageWorkflow).toContain("RELEASE_SHA=${{ github.sha }}");
expect(imageWorkflow).toContain("/api/health/live");
expect(compose).toContain("127.0.0.1:3000:3000");
expect(compose).toContain("/api/health/live");
expect(compose).not.toContain('"0.0.0.0:3000:3000"');
```

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/ops/workflows.test.ts
```

- [ ] **Step 3: Add release build arg/env to runner**

```dockerfile
ARG RELEASE_SHA=unknown
ENV DASIGAP_RELEASE_SHA=$RELEASE_SHA
```

Change Docker `HEALTHCHECK` to `/api/health/live`.

- [ ] **Step 4: Pass SHA in both runtime build actions**

For smoke and publish runtime `docker/build-push-action` calls:

```yaml
build-args: |
  RELEASE_SHA=${{ github.sha }}
```

Do not change migrator identity requirements.

- [ ] **Step 5: Make image smoke exact-SHA aware**

Replace grep-only liveness with JSON parsing of `/api/health/live`. Require `status === "ok"` and `release === "${{ github.sha }}"`. Use runner Node, not `jq`.

- [ ] **Step 6: Update Compose liveness**

Use `/api/health/live`; keep `127.0.0.1:3000:3000` unchanged.

- [ ] **Step 7: Verify GREEN**

```bash
pnpm vitest run tests/ops/workflows.test.ts
pnpm typecheck
DASIGAP_IMAGE=ghcr.io/bloombouquet/dasigap:sha-0000000000000000000000000000000000000000 \
DASIGAP_ENV_FILE="$PWD/deploy/.env.production.example" \
  docker compose -f deploy/compose.production.yml config >/dev/null
```

Confirm the branch `Production Image` run passes exact branch SHA smoke and does not publish on non-main.

- [ ] **Step 8: Commit**

```bash
git add Dockerfile .github/workflows/production-image.yml deploy/compose.production.yml tests/ops/workflows.test.ts vitest.config.ts
git commit -m "feat: bind production images to release sha"
```

---

### Task 4: Candidate-Safe Deployment and Local Restore

**Files:**
- Create: `deploy/release-common.sh`
- Rewrite: `deploy/deploy.sh`
- Create: `tests/ops/deploy-scripts.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add focused ops commands**

```json
"test:ops": "vitest run tests/ops",
"check:deploy": "sh -n deploy/release-common.sh deploy/deploy.sh deploy/rollback.sh"
```

Use `pnpm check:deploy` from CI and keep Compose config validation.

- [ ] **Step 2: Write failing stub-Docker state-machine tests**

Create a temporary executable `docker` at the front of `PATH`. It appends argv to `$DOCKER_LOG` and uses env switches to simulate inspect/pull/migrator/candidate/production results. Cover:

1. invalid tag -> exit 2, no Docker mutation;
2. pull failure -> no migration/candidate/production switch;
3. migration failure -> no candidate/production switch;
4. candidate live/ready failure -> current production untouched;
5. candidate 200 semantics with wrong release SHA -> current untouched;
6. healthy candidate -> one production recreate;
7. production local health failure -> previous immutable image restored and deployment still fails;
8. first-deploy local failure -> no fake previous target; failed app stopped/removed.

Use `sha-111...111` as current and `sha-222...222` as target.

- [ ] **Step 3: Verify RED**

```bash
pnpm vitest run tests/ops/deploy-scripts.test.ts
```

- [ ] **Step 4: Implement POSIX shared release primitives**

`deploy/release-common.sh` constants:

```sh
REGISTRY_IMAGE='ghcr.io/bloombouquet/dasigap'
PRODUCTION_CONTAINER='dasigap'
CANDIDATE_CONTAINER='dasigap-candidate'
CANDIDATE_PORT="${DASIGAP_CANDIDATE_PORT:-3101}"
HEALTH_ATTEMPTS="${DASIGAP_HEALTH_ATTEMPTS:-30}"
HEALTH_SLEEP_SECONDS="${DASIGAP_HEALTH_SLEEP_SECONDS:-1}"
```

Implement:

```text
require_image_tag
sha_from_image_tag
require_immutable_image
current_production_image
write_previous_image
remove_candidate
verify_container_health
validate_candidate
recreate_production
restore_production
stop_production
```

`write_previous_image` must remove stale `previous-image` when there is no valid current immutable image.

`validate_candidate` must run:

```sh
docker run -d --name "$CANDIDATE_CONTAINER" \
  --env-file "$ENV_FILE" \
  -p "127.0.0.1:${CANDIDATE_PORT}:3000" \
  "$image"
```

and always remove the candidate on success/failure.

`verify_container_health` uses Node inside the runtime container. It must verify both `/api/health/live` => `ok` and `/api/health/ready` => `ready`, plus `body.release === expectedSha`. Do not print body/errors.

- [ ] **Step 5: Rewrite deploy state order**

```text
validate tag/env/docker
→ capture current immutable image in memory
→ pull matching migrator/runtime
→ run migrator exactly once
→ validate loopback candidate
→ write/clear previous-image from captured current state
→ recreate production target
→ verify local live + ready + exact SHA
→ success
```

Migration/candidate failure must happen before production Compose mutation. Local post-switch failure restores the captured previous app then exits nonzero. First deploy local failure calls `stop_production` and exits nonzero. Restoration never runs migrations.

- [ ] **Step 6: Verify GREEN**

```bash
pnpm vitest run tests/ops/deploy-scripts.test.ts
pnpm check:deploy
pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add deploy/release-common.sh deploy/deploy.sh tests/ops/deploy-scripts.test.ts package.json .github/workflows/ci.yml
git commit -m "feat: add candidate-safe production deployment"
```

---

### Task 5: Candidate-Safe Rollback and Protected Workflows

**Files:**
- Rewrite: `deploy/rollback.sh`
- Modify: `tests/ops/deploy-scripts.test.ts`
- Modify: `tests/ops/workflows.test.ts`
- Modify: `.github/workflows/deploy-production.yml`
- Create: `.github/workflows/rollback-production.yml`

**Interfaces:**
- Manual: `deploy/rollback.sh [sha-<40>]`
- Workflow-only recovery: `deploy/rollback.sh --restore-previous-or-stop`
- Shared workflow concurrency: `dasigap-production-deploy`
- Environment config: `vars.PRODUCTION_BASE_URL`

- [ ] **Step 1: Add failing rollback/recovery tests**

Cover:

1. explicit rollback candidate failure -> current untouched;
2. healthy explicit candidate -> switch permitted;
3. rollback log contains no migrator image/Prisma migration;
4. rollback post-switch failure -> app that was current at rollback start restored;
5. no-arg rollback reads `previous-image`, validates it, candidate-tests it before switch;
6. `--restore-previous-or-stop` with a valid previous state candidate-tests/restores it;
7. `--restore-previous-or-stop` with no previous state stops/removes current production and does not fabricate a target;
8. deploy with no current app clears stale `previous-image`, so first-deploy external recovery cannot restore an unrelated old release.

- [ ] **Step 2: Add failing workflow security tests**

Assert both deploy/rollback workflows contain `environment: production`, `group: dasigap-production-deploy`, pinned known_hosts, `StrictHostKeyChecking=yes`, `PRODUCTION_BASE_URL`, full lowercase SHA validation, and main ancestry validation. Assert combined source has no `ssh-keyscan`, `StrictHostKeyChecking=no`, or `git pull`. Assert rollback workflow contains no `migrate-sha-` or `prisma migrate`.

- [ ] **Step 3: Verify RED**

```bash
pnpm vitest run tests/ops/deploy-scripts.test.ts tests/ops/workflows.test.ts
```

- [ ] **Step 4: Rewrite rollback.sh without migrations**

Normal rollback order:

```text
resolve explicit target or previous-image
→ validate immutable runtime + expected SHA
→ capture current immutable production image
→ pull target runtime only
→ candidate-test target
→ write/clear captured current as previous-image
→ recreate target
→ verify local live + ready + exact SHA
→ on failure restore captured current and return nonzero
```

Workflow recovery mode `--restore-previous-or-stop` is intentionally separate from normal no-arg rollback:

```text
if previous-image is valid:
  candidate-test previous -> restore it -> verify -> return result
else:
  stop/remove current production -> return success to the recovery caller
```

This mode never runs migrations and exists so an external HTTPS failure on the very first deployment can remove the failed public app without treating stale state as a rollback target.

- [ ] **Step 5: Harden Deploy Production external check**

Add:

```yaml
PRODUCTION_BASE_URL: ${{ vars.PRODUCTION_BASE_URL }}
```

Before SSH, validate via Node that URL is HTTPS and has no username/password/hash. Stage `release-common.sh` with existing deploy files.

After remote deploy success, GET `${PRODUCTION_BASE_URL%/}/api/health/ready`; parse JSON with Node and require status `ready` + exact `IMAGE_SHA`.

On external failure, always invoke:

```text
./deploy/rollback.sh --restore-previous-or-stop
```

Then best-effort verify restored external health when a previous immutable image exists. The workflow must still exit nonzero even if recovery succeeds.

- [ ] **Step 6: Create protected manual rollback workflow**

`.github/workflows/rollback-production.yml`:

- `workflow_dispatch` full 40-char `image_sha`;
- `permissions: contents: read, packages: read`;
- `group: dasigap-production-deploy`, `cancel-in-progress: false`;
- main-only job, `environment: production`;
- same pinned SSH secrets and GHCR stdin login/logout;
- `PRODUCTION_BASE_URL: ${{ vars.PRODUCTION_BASE_URL }}`;
- validate target main ancestry;
- stage `release-common.sh`, compose, rollback only; no server Git operations;
- remote `./deploy/rollback.sh "sha-$IMAGE_SHA"`;
- external ready + exact target SHA check;
- external failure -> `./deploy/rollback.sh --restore-previous-or-stop`, then workflow fails.

- [ ] **Step 7: Verify GREEN**

```bash
pnpm vitest run tests/ops/deploy-scripts.test.ts tests/ops/workflows.test.ts
pnpm check:deploy
pnpm test
```

- [ ] **Step 8: Commit**

```bash
git add deploy/rollback.sh .github/workflows/deploy-production.yml .github/workflows/rollback-production.yml tests/ops
git commit -m "feat: add protected production rollback"
```

---

### Task 6: Documentation and Full Release Gate

**Files:**
- Modify: `docs/DEPLOYMENT.md`
- Modify only if verification exposes a defect: `.github/workflows/ci.yml`, `deploy/.env.production.example`, support/test files

- [ ] **Step 1: Update the existing deployment guide**

Document immutable runtime/migrator images, `RELEASE_SHA` → `DASIGAP_RELEASE_SHA`, live vs ready vs legacy health, migration → candidate → switch → local → external order, `127.0.0.1:3101` candidate, automatic application restore, first-deploy recovery behavior, no-migration rollback, expand/contract DB compatibility, and required `production` environment configuration (`vars.PRODUCTION_BASE_URL` plus SSH secrets).

Explicitly state that merge/automation readiness does not prove actual host/TLS/Postgres/S3/BloomBouquet OAuth rollout.

- [ ] **Step 2: Run deterministic full verification**

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

- [ ] **Step 3: Run real MinIO integration**

Using the same pinned MinIO server/client as CI, create `dasigap-ci` and run:

```bash
RUN_S3_INTEGRATION=1 \
OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000 \
OBJECT_STORAGE_REGION=us-east-1 \
OBJECT_STORAGE_BUCKET=dasigap-ci \
OBJECT_STORAGE_ACCESS_KEY_ID=dasigap-ci \
OBJECT_STORAGE_SECRET_ACCESS_KEY=dasigap-ci-secret \
  pnpm exec vitest run tests/integration/s3-storage.test.ts
```

- [ ] **Step 4: Verify exact branch Production Image run**

Require runtime build arg equal branch HEAD, `/api/health/live` exact-SHA smoke PASS, migrator PostgreSQL smoke PASS, and no publish job on non-main.

- [ ] **Step 5: Security/code review**

Confirm:

```text
no secrets/.env committed
no ssh-keyscan / StrictHostKeyChecking=no / server git pull
no production selection of latest
no candidate 0.0.0.0 binding
no raw readiness dependency details
rollback has no migration execution
migration precedes candidate and production mutation
candidate failure leaves production untouched
local failure restores previous app
external failure calls --restore-previous-or-stop and workflow fails
first deploy has no stale/fake rollback target
```

- [ ] **Step 6: Map every spec failure row to a passing test**

```text
invalid SHA -> pre-SSH failure
pull failure -> current unchanged
migration failure -> current unchanged
candidate live/ready/wrong SHA -> current unchanged
local post-switch failure -> previous restored
external failure -> previous restored or first-deploy app stopped; workflow failed
rollback candidate failure -> current unchanged
rollback post-switch failure -> original current restored
```

- [ ] **Step 7: Commit documentation/fixes only when needed**

```bash
git add docs/DEPLOYMENT.md .github/workflows/ci.yml deploy/.env.production.example
git commit -m "docs: finalize production deployment runbook"
```

Do not create an empty commit.

- [ ] **Step 8: Fresh-main check and PR**

Before PR, ensure branch is not behind `main`. If `main` advanced, integrate latest `main` and rerun affected/full gates before opening PR.

Required PR title:

```text
ci : Docker 운영 배포 안정성 강화
```

Required body:

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
- local/external verification 실패 시 기록된 이전 immutable application image를 복원하며, 첫 배포에는 가짜 rollback target을 만들지 않습니다.

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

- **Spec coverage:** release identity, DB/S3 readiness, immutable SHA image, migration-first candidate, local/external recovery, manual no-migration rollback, loopback networking, pinned SSH, documentation are mapped to Tasks 1-6.
- **Placeholder scan:** no TBD/TODO or unresolved implementation branch remains. Real production values are explicit external prerequisites.
- **Identity consistency:** Docker arg `RELEASE_SHA` → runtime `DASIGAP_RELEASE_SHA`; workflow input raw 40-char SHA → server `sha-<40>` → runtime `:sha-<40>` / migrator `:migrate-sha-<40>`.
- **Health consistency:** legacy `/api/health` stays exact-compatible; new verification exclusively uses `/api/health/live` + `/api/health/ready` with exact SHA.
- **Recovery consistency:** `previous-image` is cleared when no valid current image exists; workflow-only `--restore-previous-or-stop` handles first-deploy external failure without stale/fake rollback; recovery never migrates and the initiating workflow remains failed.
- **Scope:** no PM2/tar releases, orchestration platform, DB down migration, credential provisioning, or unrelated app features are included.
