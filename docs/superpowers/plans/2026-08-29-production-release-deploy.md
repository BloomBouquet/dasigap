# Production Release and Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed production release system for Dasigap with public liveness/readiness probes, immutable release artifacts, candidate validation, atomic PM2 selection, and application rollback.

**Architecture:** Keep the existing Next.js + Prisma application and Ubuntu/Nginx/PM2 host model. Build immutable releases from `main`, validate every candidate on a loopback-only temporary port, then atomically move the `current` symlink and reload PM2; if post-switch verification fails, restore the previous symlink and keep the deployment job failed. Database migrations are forward-only and must remain compatible with the immediately previous application release.

**Tech Stack:** Next.js 16 App Router, TypeScript 5.9, Prisma 6/PostgreSQL, Vitest 4, pnpm 11.24, GitHub Actions, Bash, PM2, Nginx, S3-compatible object storage with AWS SigV4.

**Spec:** `docs/superpowers/specs/2026-08-29-production-release-deploy-design.md`

## Global Constraints

- Production runtime is Node.js 22.
- Package manager is exactly `pnpm@11.24.0` and CI/release installs use `pnpm install --frozen-lockfile`.
- Production deployment stays on the existing Ubuntu + Nginx + PM2 operating model; no Docker/Kubernetes deployment layer is introduced.
- Release build, deploy, and rollback are manual `workflow_dispatch` operations; merging `main` does not automatically deploy.
- Repository code and GitHub artifacts must never contain `.env.production`, OAuth client secrets, PostgreSQL credentials, S3 credentials, or SSH private keys.
- Production SSH host verification uses the pinned `PRODUCTION_KNOWN_HOSTS` secret; runtime `ssh-keyscan` is forbidden.
- `GET /api/health/live` must not touch backing services.
- `GET /api/health/ready` returns HTTP 200 only when PostgreSQL and S3-compatible private storage are ready; failures return HTTP 503 without dependency details.
- Health responses use `Cache-Control: no-store` and expose only service status plus release SHA.
- Candidate processes bind only to loopback and default to port `3101`; production defaults to port `3000`.
- A release must pass candidate `/live` and `/ready` checks before `current` changes.
- Application selection uses same-filesystem atomic symlink replacement; never remove `current` before its replacement exists.
- `prisma migrate deploy` is forward-only. Standard production migrations must be backward-compatible with the immediately previous application release.
- Automatic and manual rollback never run database down migrations.
- Keep the active release, previous release, and three additional recent installed releases.

---

## File Structure

Create or modify the following focused units:

- `src/health/release.ts` — release identity helper used by both health routes.
- `src/health/readiness.ts` — dependency readiness orchestration with bounded timeouts and dependency-detail suppression.
- `src/health/readiness.test.ts` — unit tests for database/storage success, failure, and timeout behavior.
- `app/api/health/live/route.ts` — unauthenticated liveness HTTP endpoint.
- `app/api/health/ready/route.ts` — unauthenticated readiness HTTP endpoint.
- `tests/integration/health-api.test.ts` — route contract tests for status codes, body shape, cache headers, and no auth requirement.
- `src/documents/storage.ts` — extend the existing S3 boundary with a non-mutating authenticated bucket readiness probe; reuse existing credential parsing and SigV4 helpers.
- `tests/integration/s3-storage.test.ts` — exercise the new readiness probe against the CI MinIO service.
- `ops/release/common.sh` — shared safe shell helpers: metadata validation, environment loading, health polling, atomic link replacement, and release-path validation.
- `ops/release/prepare-release.sh` — prepare immutable release directory, install exact dependencies, generate Prisma, and run `prisma migrate deploy`.
- `ops/release/validate-candidate.sh` — start/stop a loopback candidate and require matching release SHA from live/ready endpoints.
- `ops/release/switch-release.sh` — update `previous`/`current`, PM2 reload, post-switch checks, and automatic application rollback on failure.
- `ops/release/rollback-release.sh` — candidate-validate an installed target SHA and select it atomically without database migration.
- `ops/pm2/ecosystem.config.cjs` — tracked production PM2 configuration that resolves `current`, loads host-only env, and exposes `DASIGAP_RELEASE_SHA`.
- `tests/ops/release-scripts.test.ts` — temp-filesystem tests for traversal rejection, immutable release validation, atomic link behavior, and rollback preservation using stubbed PM2/curl commands.
- `.github/workflows/build-production-release.yml` — manual verified release artifact build from `main`.
- `.github/workflows/deploy-production-release.yml` — manual artifact-to-server deployment using GitHub `production` environment.
- `.github/workflows/rollback-production-release.yml` — manual installed-release rollback using the same production concurrency group.
- `.github/workflows/ci.yml` — include shell syntax/ops tests and S3 readiness integration in the existing branch/PR gate.
- `package.json` — add explicit production/ops verification scripts only where they reduce duplicated workflow commands.
- `.env.example` — document non-secret runtime settings such as release root/ports without adding production secret values.
- `docs/release/mvp-checklist.md` — replace the deployment placeholder with exact rollout prerequisites and smoke/rollback gates.

---

### Task 1: Release Identity and Public Liveness

**Files:**
- Create: `src/health/release.ts`
- Create: `app/api/health/live/route.ts`
- Create: `tests/integration/health-api.test.ts`

**Interfaces:**
- Produces: `getReleaseSha(env?: NodeJS.ProcessEnv): string`
- Produces: `GET(): Promise<Response>` for `/api/health/live`
- Later tasks consume `getReleaseSha()` for readiness responses and release-SHA verification.

- [ ] **Step 1: Write the failing liveness contract test**

Create `tests/integration/health-api.test.ts` with the liveness portion first:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getLive } from "../../app/api/health/live/route";

describe("health API", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns public liveness with the selected release SHA", async () => {
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

  it("uses unknown outside a packaged release", async () => {
    vi.stubEnv("DASIGAP_RELEASE_SHA", "");
    const response = await getLive();
    expect((await response.json()).release).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run tests/integration/health-api.test.ts
```

Expected: FAIL because `app/api/health/live/route.ts` does not exist.

- [ ] **Step 3: Implement release identity and liveness**

Create `src/health/release.ts`:

```ts
const FULL_SHA = /^[0-9a-f]{40}$/i;

export function getReleaseSha(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.DASIGAP_RELEASE_SHA?.trim();
  return value && FULL_SHA.test(value) ? value.toLowerCase() : "unknown";
}
```

Create `app/api/health/live/route.ts`:

```ts
import { NextResponse } from "next/server";

import { getReleaseSha } from "../../../../src/health/release";

export async function GET() {
  return NextResponse.json(
    { status: "ok", service: "dasigap", release: getReleaseSha() },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
```

Do not import auth, Prisma, or storage from the liveness route.

- [ ] **Step 4: Run focused and type checks**

Run:

```bash
pnpm exec vitest run tests/integration/health-api.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the liveness boundary**

```bash
git add src/health/release.ts app/api/health/live/route.ts tests/integration/health-api.test.ts
git commit -m "feat: add production liveness endpoint"
```

---

### Task 2: PostgreSQL and S3 Readiness

**Files:**
- Create: `src/health/readiness.ts`
- Create: `src/health/readiness.test.ts`
- Create: `app/api/health/ready/route.ts`
- Modify: `src/documents/storage.ts`
- Modify: `tests/integration/s3-storage.test.ts`
- Modify: `tests/integration/health-api.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: existing `prisma` from `src/db/prisma.ts`.
- Produces: `checkObjectStorageReadiness(options?: { timeoutMs?: number }): Promise<boolean>` in `src/documents/storage.ts`.
- Produces: `checkReadiness(deps?: ReadinessDependencies): Promise<boolean>` in `src/health/readiness.ts`.
- Produces: `GET(): Promise<Response>` for `/api/health/ready`.

- [ ] **Step 1: Add RED tests for the non-mutating S3 probe**

Extend `tests/integration/s3-storage.test.ts` imports:

```ts
import {
  checkObjectStorageReadiness,
  createSignedReadUrl,
  deletePrivateObject,
  putPrivateObject,
} from "../../src/documents/storage";
```

Add inside the existing MinIO-backed suite:

```ts
it("proves the configured private bucket is reachable without mutating it", async () => {
  await expect(checkObjectStorageReadiness({ timeoutMs: 2_000 })).resolves.toBe(true);
});
```

- [ ] **Step 2: Add RED unit tests for readiness orchestration**

Create `src/health/readiness.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { checkReadiness } from "./readiness";

describe("checkReadiness", () => {
  it("is ready only when database and object storage are ready", async () => {
    const database = vi.fn().mockResolvedValue(true);
    const storage = vi.fn().mockResolvedValue(true);
    await expect(checkReadiness({ database, storage, timeoutMs: 100 })).resolves.toBe(true);
  });

  it("returns false when either required dependency fails", async () => {
    await expect(checkReadiness({
      database: vi.fn().mockResolvedValue(false),
      storage: vi.fn().mockResolvedValue(true),
      timeoutMs: 100,
    })).resolves.toBe(false);
  });

  it("returns false when dependency probing exceeds the bound", async () => {
    const never = () => new Promise<boolean>(() => {});
    await expect(checkReadiness({ database: never, storage: never, timeoutMs: 10 })).resolves.toBe(false);
  });
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run src/health/readiness.test.ts tests/integration/s3-storage.test.ts
```

Expected: FAIL because both exported readiness functions are missing.

- [ ] **Step 4: Extend the existing S3 boundary with signed HEAD**

Refactor only enough of `src/documents/storage.ts` to reuse its existing `requireConfiguration`, `objectUrl`, SHA/HMAC, and SigV4 helpers. Add a `HEAD` signer that signs an empty body and an exported probe:

```ts
export async function checkObjectStorageReadiness(
  { timeoutMs = 2_000 }: { timeoutMs?: number } = {},
): Promise<boolean> {
  try {
    const config = requireConfiguration();
    const url = objectUrl(config, "");
    url.pathname = url.pathname.replace(/\/$/, "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = signedHeadersForRequest("HEAD", url, new Uint8Array());
      const response = await fetch(url, { method: "HEAD", headers, signal: controller.signal });
      return response.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}
```

Update the internal signer type from `"PUT" | "DELETE"` to `"PUT" | "DELETE" | "HEAD"`. Ensure bucket URL canonicalization matches MinIO/AWS path-style behavior and do not create/delete an object during readiness.

- [ ] **Step 5: Implement bounded dependency orchestration**

Create `src/health/readiness.ts`:

```ts
import { prisma } from "../db/prisma";
import { checkObjectStorageReadiness } from "../documents/storage";

export type ReadinessDependencies = {
  database: () => Promise<boolean>;
  storage: () => Promise<boolean>;
  timeoutMs: number;
};

async function databaseReady() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T | false> {
  return Promise.race([
    promise,
    new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

export async function checkReadiness(
  deps: ReadinessDependencies = {
    database: databaseReady,
    storage: () => checkObjectStorageReadiness({ timeoutMs: 2_000 }),
    timeoutMs: 2_500,
  },
): Promise<boolean> {
  const [database, storage] = await Promise.all([
    within(deps.database(), deps.timeoutMs),
    within(deps.storage(), deps.timeoutMs),
  ]);
  return database === true && storage === true;
}
```

Do not log raw credentials, URLs, SQL messages, or provider bodies from this layer.

- [ ] **Step 6: Add the readiness route and route contract tests**

Create `app/api/health/ready/route.ts`:

```ts
import { NextResponse } from "next/server";

import { checkReadiness } from "../../../../src/health/readiness";
import { getReleaseSha } from "../../../../src/health/release";

export async function GET() {
  const ready = await checkReadiness();
  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      service: "dasigap",
      release: getReleaseSha(),
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
```

In `tests/integration/health-api.test.ts`, mock `src/health/readiness` before importing the ready route and assert both 200 and 503 response shapes. The failure body must not contain strings such as `DATABASE_URL`, `OBJECT_STORAGE_ENDPOINT`, `postgres`, or a bucket name.

- [ ] **Step 7: Run unit/integration tests including real MinIO**

Run the existing MinIO container sequence from `.github/workflows/ci.yml`, then:

```bash
pnpm exec vitest run src/health/readiness.test.ts tests/integration/health-api.test.ts
RUN_S3_INTEGRATION=1 \
OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000 \
OBJECT_STORAGE_REGION=us-east-1 \
OBJECT_STORAGE_BUCKET=dasigap-ci \
OBJECT_STORAGE_ACCESS_KEY_ID=dasigap-ci \
OBJECT_STORAGE_SECRET_ACCESS_KEY=dasigap-ci-secret \
pnpm exec vitest run tests/integration/s3-storage.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Add the readiness S3 assertion to CI and commit**

Keep the existing MinIO startup step. The existing `Real S3 signed URL integration` command already executes `tests/integration/s3-storage.test.ts`, so no second container is needed; only ensure the new test runs in that file.

Commit:

```bash
git add src/health app/api/health src/documents/storage.ts tests/integration/health-api.test.ts tests/integration/s3-storage.test.ts .github/workflows/ci.yml
git commit -m "feat: add production readiness checks"
```

---

### Task 3: Immutable Production Release Artifact

**Files:**
- Create: `ops/release/create-artifact.mjs`
- Create: `ops/release/create-artifact.test.ts`
- Create: `.github/workflows/build-production-release.yml`
- Modify: `package.json`

**Interfaces:**
- Produces CLI: `node ops/release/create-artifact.mjs <commit-sha> <output-dir>`.
- Produces: `<output-dir>/release-metadata.json` and `<output-dir>/dasigap-release-<sha>.tgz`.
- Deploy workflow later consumes exactly those two files.

- [ ] **Step 1: Write RED artifact metadata tests**

Create `ops/release/create-artifact.test.ts` around exported helpers from the module:

```ts
import { describe, expect, it } from "vitest";

import { createReleaseMetadata, validateCommitSha } from "./create-artifact.mjs";

describe("release artifact metadata", () => {
  it("requires a full git SHA", () => {
    expect(() => validateCommitSha("abc123")).toThrow();
    expect(validateCommitSha("a".repeat(40))).toBe("a".repeat(40));
  });

  it("records immutable non-secret identity", () => {
    expect(createReleaseMetadata("b".repeat(40), new Date("2026-08-29T00:00:00Z"))).toEqual({
      service: "dasigap",
      commitSha: "b".repeat(40),
      builtAt: "2026-08-29T00:00:00.000Z",
      nodeMajor: 22,
      packageManager: "pnpm@11.24.0",
    });
  });
});
```

- [ ] **Step 2: Run focused artifact tests and verify RED**

```bash
pnpm exec vitest run ops/release/create-artifact.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement deterministic metadata and safe packaging**

Create `ops/release/create-artifact.mjs` with named exports and a CLI guard. `validateCommitSha` accepts only `/^[0-9a-f]{40}$/`. `createReleaseMetadata` returns exactly the shape in the test. The CLI writes metadata at repository root temporarily, then invokes `tar` with an explicit allowlist rather than packaging `.`:

```js
const releasePaths = [
  ".next",
  "app",
  "components",
  "public",
  "src",
  "prisma",
  "ops",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "next.config.ts",
  "release-metadata.json",
];
```

Reject a missing `.next` directory or missing required file. Never glob `.env*`.

- [ ] **Step 4: Add production artifact workflow**

Create `.github/workflows/build-production-release.yml` with:

```yaml
name: Build production release

on:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: dasigap-production-release-artifact
  cancel-in-progress: false

jobs:
  build-release:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: dasigap
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres -d dasigap"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/dasigap
    steps:
      - uses: actions/checkout@v6
        with:
          ref: main
      - uses: actions/setup-node@v6
        with:
          node-version: 22
      - name: Enable pnpm
        run: |
          corepack enable
          corepack prepare pnpm@11.24.0 --activate
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:generate
      - run: pnpm prisma validate
      - run: pnpm prisma migrate deploy
      - run: pnpm typecheck
      - run: pnpm test
      - name: Start S3-compatible MinIO
        run: |
          docker run -d --name dasigap-minio -p 9000:9000 \
            -e MINIO_ROOT_USER=dasigap-ci \
            -e MINIO_ROOT_PASSWORD=dasigap-ci-secret \
            minio/minio:RELEASE.2025-09-07T16-13-09Z server /data
          for attempt in $(seq 1 30); do
            curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null && break
            sleep 1
          done
          docker run --rm --network host --entrypoint /bin/sh \
            minio/mc:RELEASE.2025-08-13T08-35-41Z \
            -c 'mc alias set ci http://127.0.0.1:9000 dasigap-ci dasigap-ci-secret && mc mb --ignore-existing ci/dasigap-ci'
      - name: Real S3 integration
        env:
          RUN_S3_INTEGRATION: "1"
          OBJECT_STORAGE_ENDPOINT: http://127.0.0.1:9000
          OBJECT_STORAGE_REGION: us-east-1
          OBJECT_STORAGE_BUCKET: dasigap-ci
          OBJECT_STORAGE_ACCESS_KEY_ID: dasigap-ci
          OBJECT_STORAGE_SECRET_ACCESS_KEY: dasigap-ci-secret
        run: pnpm exec vitest run tests/integration/s3-storage.test.ts
      - run: pnpm build
      - run: pnpm test:e2e
      - name: Package release
        run: node ops/release/create-artifact.mjs "$(git rev-parse HEAD)" release-output
      - uses: actions/upload-artifact@v4
        with:
          name: dasigap-production-${{ github.sha }}
          retention-days: 14
          if-no-files-found: error
          path: release-output/
```

During implementation, use an explicit step output for the checked-out `main` SHA if `${{ github.sha }}` does not reflect the checkout target on `workflow_dispatch`; artifact naming must use the actual `git rev-parse HEAD` value, not the dispatch event SHA.

- [ ] **Step 5: Add local verification script and run it**

Add to `package.json`:

```json
"verify:release-artifact": "vitest run ops/release/create-artifact.test.ts"
```

Run:

```bash
pnpm verify:release-artifact
pnpm build
rm -rf /tmp/dasigap-release-test
node ops/release/create-artifact.mjs "$(git rev-parse HEAD)" /tmp/dasigap-release-test
node -e 'const m=require("/tmp/dasigap-release-test/release-metadata.json"); if(m.service!=="dasigap") process.exit(1)'
tar -tzf /tmp/dasigap-release-test/dasigap-release-*.tgz | grep -E '(^|/)\.env' && exit 1 || true
```

Expected: metadata is valid, archive is non-empty, and no `.env` path exists.

- [ ] **Step 6: Commit artifact building**

```bash
git add ops/release/create-artifact.mjs ops/release/create-artifact.test.ts .github/workflows/build-production-release.yml package.json
git commit -m "feat: build immutable production releases"
```

---

### Task 4: Server Release Runtime, Candidate Validation, and Atomic Switch

**Files:**
- Create: `ops/release/common.sh`
- Create: `ops/release/prepare-release.sh`
- Create: `ops/release/validate-candidate.sh`
- Create: `ops/release/switch-release.sh`
- Create: `ops/pm2/ecosystem.config.cjs`
- Create: `tests/ops/release-scripts.test.ts`
- Modify: `package.json`

**Interfaces:**
- `common.sh`: `require_full_sha`, `release_path`, `read_release_sha`, `atomic_link`, `wait_for_health`.
- `prepare-release.sh <staging-dir> <sha>` prepares `$DASIGAP_ROOT/releases/<sha>` and runs migration once for a new release.
- `validate-candidate.sh <release-dir> <sha>` exits 0 only when live and ready both report the exact SHA.
- `switch-release.sh <sha> <production-base-url>` performs atomic switch, PM2 reload, post-switch validation, and automatic application rollback.
- PM2 process name: `dasigap`.

- [ ] **Step 1: Write RED shell-boundary tests**

Create `tests/ops/release-scripts.test.ts`. Use `mkdtemp`, `execFile`, and a temporary `DASIGAP_ROOT`. Initial tests must verify:

```ts
it("rejects a non-full SHA before constructing a release path", async () => { /* expect exit != 0 */ });
it("never allows target_sha path traversal", async () => { /* ../../etc/passwd rejected */ });
it("atomically points current at an installed release and previous at the old release", async () => { /* inspect readlink */ });
it("keeps current unchanged when candidate validation fails", async () => { /* stub validator non-zero */ });
it("restores the old current when post-switch production health fails", async () => { /* stub curl failure after switch */ });
```

The test harness supplies stub executables earlier in `PATH` for `pm2`, `curl`, and candidate startup so no real server process is required for atomic-link behavior tests.

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run tests/ops/release-scripts.test.ts
```

Expected: FAIL because the scripts do not exist.

- [ ] **Step 3: Implement shared fail-closed shell helpers**

Create `ops/release/common.sh` beginning with:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

DASIGAP_ROOT="${DASIGAP_ROOT:-/home/ubuntu/dasigap}"
DASIGAP_RELEASES="$DASIGAP_ROOT/releases"
DASIGAP_SHARED="$DASIGAP_ROOT/shared"

require_full_sha() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]] || {
    echo "invalid release sha" >&2
    return 64
  }
}

release_path() {
  require_full_sha "$1"
  printf '%s/%s\n' "$DASIGAP_RELEASES" "$1"
}

read_release_sha() {
  node -e '
    const fs=require("node:fs");
    const m=JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if(m.service!=="dasigap" || !/^[0-9a-f]{40}$/.test(m.commitSha)) process.exit(65);
    process.stdout.write(m.commitSha);
  ' "$1/release-metadata.json"
}

atomic_link() {
  local target="$1" link="$2" temp="${link}.tmp.$$"
  ln -s "$target" "$temp"
  mv -Tf "$temp" "$link"
}
```

Add `wait_for_health <url> <sha> <expected-status>` that uses `curl --fail --silent --show-error --max-time 3`, retries a bounded number of times, parses JSON with Node, and requires the body release to equal the requested SHA. Do not echo response bodies on failure.

- [ ] **Step 4: Implement immutable release preparation**

`ops/release/prepare-release.sh <staging-dir> <sha>` must:

```bash
source "$(dirname "$0")/common.sh"
require_full_sha "$2"
target="$(release_path "$2")"

[[ -f "$DASIGAP_SHARED/.env.production" ]] || { echo "missing production env" >&2; exit 66; }
[[ "$(read_release_sha "$1")" == "$2" ]] || exit 65

if [[ -e "$target" ]]; then
  [[ "$(read_release_sha "$target")" == "$2" ]] || exit 65
  exit 0
fi

set -a
source "$DASIGAP_SHARED/.env.production"
set +a

cd "$1"
pnpm install --frozen-lockfile
pnpm db:generate
pnpm prisma migrate deploy
cd "$DASIGAP_ROOT"
mv "$1" "$target"
```

The implementation must ensure staging and releases are on the same filesystem and must clean only its own temporary staging directory on failure.

- [ ] **Step 5: Implement candidate validation**

`ops/release/validate-candidate.sh <release-dir> <sha>` must load `shared/.env.production`, use `HOSTNAME=127.0.0.1`, override `PORT=${DASIGAP_CANDIDATE_PORT:-3101}` and `DASIGAP_RELEASE_SHA`, start the release-local `next start` as a temporary background process, trap cleanup, wait for `/api/health/live`, then `/api/health/ready`, and always stop the candidate before returning.

Core shape:

```bash
HOSTNAME=127.0.0.1 PORT="$candidate_port" DASIGAP_RELEASE_SHA="$sha" \
  pnpm --dir "$release_dir" exec next start >"$candidate_log" 2>&1 &
candidate_pid=$!
trap 'kill "$candidate_pid" 2>/dev/null || true; wait "$candidate_pid" 2>/dev/null || true' EXIT
wait_for_health "http://127.0.0.1:$candidate_port/api/health/live" "$sha" ok
wait_for_health "http://127.0.0.1:$candidate_port/api/health/ready" "$sha" ready
```

Do not print the loaded environment file or candidate process environment.

- [ ] **Step 6: Implement tracked PM2 runtime**

Create `ops/pm2/ecosystem.config.cjs`. It must resolve root/current/shared, load only the host env file, validate release metadata, and run the release-local Next binary. Example structure:

```js
const fs = require("node:fs");
const path = require("node:path");

const root = process.env.DASIGAP_ROOT || "/home/ubuntu/dasigap";
const current = path.join(root, "current");
const envFile = path.join(root, "shared", ".env.production");
process.loadEnvFile(envFile);
const metadata = JSON.parse(fs.readFileSync(path.join(current, "release-metadata.json"), "utf8"));
if (metadata.service !== "dasigap" || !/^[0-9a-f]{40}$/.test(metadata.commitSha)) {
  throw new Error("Invalid release metadata");
}

module.exports = {
  apps: [{
    name: "dasigap",
    cwd: current,
    script: path.join(current, "node_modules", "next", "dist", "bin", "next"),
    args: "start",
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: process.env.PORT || "3000",
      DASIGAP_RELEASE_SHA: metadata.commitSha,
    },
    autorestart: true,
    max_restarts: 5,
    min_uptime: "10s",
  }],
};
```

- [ ] **Step 7: Implement switch and automatic rollback**

`ops/release/switch-release.sh <sha> <production-base-url>` must:

1. validate the SHA and installed metadata;
2. run `validate-candidate.sh` before link changes;
3. capture old `current` target if any;
4. atomically set `previous` to old target when present;
5. atomically set `current` to the candidate;
6. run `pm2 startOrReload "$candidate/ops/pm2/ecosystem.config.cjs" --update-env`;
7. require local production ready + external HTTPS ready with exact SHA;
8. on any failure after the switch, restore old `current`, reload old PM2, probe restored local health, and return non-zero.

Use an `ERR` trap only after `current` has changed, and explicitly disable the trap while performing rollback to avoid recursion.

- [ ] **Step 8: Run shell syntax and ops behavior tests**

Add to `package.json`:

```json
"test:ops": "vitest run tests/ops/release-scripts.test.ts",
"check:ops": "bash -n ops/release/common.sh ops/release/prepare-release.sh ops/release/validate-candidate.sh ops/release/switch-release.sh"
```

Run:

```bash
pnpm test:ops
pnpm check:ops
node -e 'require("./ops/pm2/ecosystem.config.cjs")' # run only with a temp DASIGAP_ROOT fixture in the test harness
```

Expected: PASS.

- [ ] **Step 9: Commit runtime release switching**

```bash
git add ops/release ops/pm2 tests/ops package.json
git commit -m "feat: add atomic production release switching"
```

---

### Task 5: Manual Deploy Workflow with Artifact Validation

**Files:**
- Create: `.github/workflows/deploy-production-release.yml`
- Create: `ops/release/validate-artifact.mjs`
- Create: `ops/release/validate-artifact.test.ts`
- Modify: `package.json`

**Interfaces:**
- Workflow input: required `release_run_id` string containing digits only.
- Required production secrets: `PRODUCTION_HOST`, `PRODUCTION_USER`, `PRODUCTION_SSH_KEY`, `PRODUCTION_KNOWN_HOSTS`, `PRODUCTION_BASE_URL`; optional `PRODUCTION_SSH_PORT` defaults to 22.
- `validate-artifact.mjs <metadata-path> <archive-path>` prints validated commit SHA only.
- Server executes `prepare-release.sh`, then `switch-release.sh`.

- [ ] **Step 1: Write RED artifact validation tests**

Create `ops/release/validate-artifact.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateArtifactMetadata } from "./validate-artifact.mjs";

describe("production artifact validation", () => {
  it("accepts only dasigap metadata with a full SHA", () => {
    expect(validateArtifactMetadata({ service: "dasigap", commitSha: "a".repeat(40) })).toBe("a".repeat(40));
    expect(() => validateArtifactMetadata({ service: "other", commitSha: "a".repeat(40) })).toThrow();
    expect(() => validateArtifactMetadata({ service: "dasigap", commitSha: "../main" })).toThrow();
  });
});
```

- [ ] **Step 2: Run RED and implement validator**

Run:

```bash
pnpm exec vitest run ops/release/validate-artifact.test.ts
```

Then create `ops/release/validate-artifact.mjs` that parses JSON, requires `service === "dasigap"`, requires `/^[0-9a-f]{40}$/`, requires a non-empty archive file, and prints only the SHA on success. Re-run the test and expect PASS.

- [ ] **Step 3: Implement deploy workflow preflight**

Create `.github/workflows/deploy-production-release.yml`:

```yaml
name: Deploy production release

on:
  workflow_dispatch:
    inputs:
      release_run_id:
        description: Successful Build production release run ID
        required: true
        type: string

permissions:
  actions: read
  contents: read

env:
  DASIGAP_ROOT: /home/ubuntu/dasigap

jobs:
  deploy:
    environment: production
    runs-on: ubuntu-latest
    timeout-minutes: 20
    concurrency:
      group: dasigap-production-deploy
      cancel-in-progress: false
```

First steps must reject a non-numeric run ID, query `GET /repos/${GITHUB_REPOSITORY}/actions/runs/<id>` using `gh api`, and require all of:

- run event is `workflow_dispatch`;
- conclusion is `success`;
- workflow path/name resolves to `build-production-release.yml`;
- run head SHA is in `main` history.

Use `actions/download-artifact@v4` with `run-id` and `github-token`, not a caller-supplied artifact name/path. Validate the downloaded metadata/archive locally with `validate-artifact.mjs`.

- [ ] **Step 4: Pin SSH trust and upload to a unique staging path**

Workflow SSH setup must use:

```bash
install -m 700 -d ~/.ssh
printf '%s\n' "$PRODUCTION_KNOWN_HOSTS" > ~/.ssh/known_hosts
chmod 600 ~/.ssh/known_hosts
printf '%s\n' "$PRODUCTION_SSH_KEY" > ~/.ssh/id_ed25519
chmod 600 ~/.ssh/id_ed25519
```

Never call `ssh-keyscan`. Compute port from `${PRODUCTION_SSH_PORT:-22}`. Upload the archive and metadata to a server path generated only from validated SHA, for example:

```text
$DASIGAP_ROOT/.staging/<sha>-<github-run-id>/
```

Create the remote directory with quoted positional parameters passed to `bash -s --`, not shell interpolation of unvalidated input.

- [ ] **Step 5: Extract, prepare, and switch on the host**

The remote script must:

```bash
set -Eeuo pipefail
root="${DASIGAP_ROOT:-/home/ubuntu/dasigap}"
staging="$root/.staging/$sha-$deploy_run_id"
mkdir -p "$root/releases" "$root/shared" "$root/.staging"
tar -xzf "$staging/dasigap-release-$sha.tgz" -C "$staging/release"
"$staging/release/ops/release/prepare-release.sh" "$staging/release" "$sha"
"$root/releases/$sha/ops/release/switch-release.sh" "$sha" "$production_base_url"
```

Pass `production_base_url` from the GitHub secret as a positional argument and require it to parse as HTTPS before SSH. Do not put it into repository code.

- [ ] **Step 6: Add deploy workflow static checks to CI**

Add tests or a small Node YAML/text invariant test under `tests/ops/workflows.test.ts` that reads all production workflows and requires:

- `workflow_dispatch` present;
- `environment: production` present on deploy/rollback;
- `cancel-in-progress: false`;
- no `ssh-keyscan`;
- no `git pull`;
- no secret values printed with `set -x`.

Run:

```bash
pnpm exec vitest run ops/release/validate-artifact.test.ts tests/ops/workflows.test.ts
pnpm test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit production deployment workflow**

```bash
git add .github/workflows/deploy-production-release.yml ops/release/validate-artifact.mjs ops/release/validate-artifact.test.ts tests/ops/workflows.test.ts package.json
git commit -m "feat: add production deployment workflow"
```

---

### Task 6: Manual Rollback, Retention, Documentation, and Full Release Gate

**Files:**
- Create: `ops/release/rollback-release.sh`
- Create: `ops/release/cleanup-releases.sh`
- Create: `.github/workflows/rollback-production-release.yml`
- Modify: `tests/ops/release-scripts.test.ts`
- Modify: `tests/ops/workflows.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `.env.example`
- Modify: `docs/release/mvp-checklist.md`
- Modify: `package.json`

**Interfaces:**
- Rollback workflow input: `target_sha` full 40-character lowercase hexadecimal SHA.
- `rollback-release.sh <target-sha> <production-base-url>` never migrates DB and leaves `current` untouched until target candidate passes.
- `cleanup-releases.sh` preserves resolved `current`, resolved `previous`, and three newest additional release directories.

- [ ] **Step 1: Extend RED ops tests for manual rollback and retention**

Add tests to `tests/ops/release-scripts.test.ts`:

```ts
it("does not run prisma migrate during manual rollback", async () => { /* stub pnpm and assert no migrate call */ });
it("leaves current untouched when rollback target candidate is unhealthy", async () => { /* expect same readlink */ });
it("sets previous to the formerly active release after successful rollback", async () => { /* inspect both links */ });
it("cleanup keeps current, previous, and three additional newest releases", async () => { /* create timestamped fixtures */ });
```

- [ ] **Step 2: Implement manual rollback script**

Create `ops/release/rollback-release.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"

sha="${1:?target sha required}"
base_url="${2:?production base url required}"
require_full_sha "$sha"
target="$(release_path "$sha")"
[[ -d "$target" ]] || { echo "release not installed" >&2; exit 67; }
[[ "$(read_release_sha "$target")" == "$sha" ]] || exit 65

"$target/ops/release/validate-candidate.sh" "$target" "$sha"
old=""
[[ -L "$DASIGAP_ROOT/current" ]] && old="$(readlink -f "$DASIGAP_ROOT/current")"
[[ -n "$old" ]] && atomic_link "$old" "$DASIGAP_ROOT/previous"
atomic_link "$target" "$DASIGAP_ROOT/current"
pm2 startOrReload "$target/ops/pm2/ecosystem.config.cjs" --update-env
wait_for_health "http://127.0.0.1:${PORT:-3000}/api/health/ready" "$sha" ready
wait_for_health "$base_url/api/health/ready" "$sha" ready
```

If post-switch verification fails, use the same restoration helper as normal deploy to put `old` back; do not duplicate two different rollback algorithms.

- [ ] **Step 3: Implement safe release cleanup**

Create `ops/release/cleanup-releases.sh` that gathers only immediate child directory names matching `^[0-9a-f]{40}$`, resolves `current` and `previous`, sorts remaining release directories by modification time, protects the three newest extras, then removes only unprotected matching release directories. Never call `rm -rf` on a path assembled from unvalidated external input.

Run cleanup only after successful external post-switch readiness, never after failed deploy/rollback.

- [ ] **Step 4: Add rollback workflow**

Create `.github/workflows/rollback-production-release.yml`:

```yaml
name: Rollback production release

on:
  workflow_dispatch:
    inputs:
      target_sha:
        description: Installed release commit SHA
        required: true
        type: string

permissions:
  contents: read

jobs:
  rollback:
    environment: production
    runs-on: ubuntu-latest
    timeout-minutes: 15
    concurrency:
      group: dasigap-production-deploy
      cancel-in-progress: false
```

Validate `target_sha` locally before SSH, configure the same pinned known-hosts SSH setup as deploy, and invoke only:

```bash
$DASIGAP_ROOT/releases/$target_sha/ops/release/rollback-release.sh "$target_sha" "$PRODUCTION_BASE_URL"
```

The workflow must not download artifacts, run `pnpm install`, run `prisma migrate deploy`, or call `git` on the server.

- [ ] **Step 5: Document non-secret runtime contract**

Append safe defaults/comments to `.env.example` without real production values:

```dotenv
DASIGAP_RELEASE_SHA=
DASIGAP_ROOT=/home/ubuntu/dasigap
PORT=3000
DASIGAP_CANDIDATE_PORT=3101
```

Do not add GitHub SSH secrets or a real production hostname to `.env.example`.

- [ ] **Step 6: Update release checklist with exact rollout gates**

In `docs/release/mvp-checklist.md`, require before first production deploy:

1. GitHub `production` environment exists.
2. SSH secrets and pinned known-hosts are configured.
3. Host Node 22/Corepack/PM2/Nginx prerequisites are installed.
4. `shared/.env.production` contains production PostgreSQL, private storage, and BloomBouquet OAuth configuration and is permissions-restricted.
5. Exact HTTPS BloomBouquet callback URI is registered centrally.
6. Build production release workflow succeeds for `main` SHA.
7. Deploy workflow succeeds and external `/api/health/ready` reports that SHA.
8. Real browser smoke: authorize → callback → Dasigap session → protected API → logout.
9. Upload/read/delete private document smoke succeeds.
10. Manual rollback is exercised to an installed compatible release and forward deploy is exercised again.

Also state that destructive DB migrations require a separate operations plan and are blocked from the normal release path.

- [ ] **Step 7: Wire ops gates into normal CI**

Add to `package.json`:

```json
"verify:ops": "pnpm check:ops && vitest run tests/ops ops/release/create-artifact.test.ts ops/release/validate-artifact.test.ts"
```

In `.github/workflows/ci.yml`, after typecheck add:

```yaml
- name: Production operations verification
  run: pnpm verify:ops
```

Keep all existing unit/integration/security, MinIO, build, and Playwright gates intact.

- [ ] **Step 8: Run the complete local/CI-equivalent gate**

Run:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm prisma validate
pnpm prisma migrate deploy
pnpm typecheck
pnpm verify:ops
pnpm test
# Start MinIO exactly as CI does, then run the real S3 integration.
pnpm build
pnpm test:e2e
```

Expected: every command exits 0. Confirm `git diff --check` is clean.

- [ ] **Step 9: Review migration compatibility and production security boundaries**

Before PR, inspect all migrations added by this branch (normally none). Verify:

- no destructive migration was introduced;
- deploy/rollback never emits secret contents;
- `ssh-keyscan`, `StrictHostKeyChecking=no`, `git pull`, and server-side repository checkout are absent;
- rollback never invokes `prisma migrate`;
- candidate validation precedes `current` mutation;
- failed post-switch health returns non-zero even when automatic rollback succeeds;
- external health checks require the exact release SHA.

Run:

```bash
grep -R "ssh-keyscan\|StrictHostKeyChecking=no\|git pull" .github/workflows ops && exit 1 || true
grep -R "prisma migrate" ops/release/rollback-release.sh && exit 1 || true
git diff --check
git status --short
```

- [ ] **Step 10: Commit final rollback/release gate work**

```bash
git add ops/release/rollback-release.sh ops/release/cleanup-releases.sh .github/workflows/rollback-production-release.yml tests/ops .github/workflows/ci.yml .env.example docs/release/mvp-checklist.md package.json
git commit -m "feat: add production rollback release gate"
```

- [ ] **Step 11: Push and open PR with the project-required format**

Push `dasigap/devops-production-release`, wait for branch CI, then create a PR into `main` titled:

```text
feat : 운영 배포 및 롤백 파이프라인 구축
```

Use exactly this body structure:

```markdown
# ✨ PR 내용

## 📝 코드 변경 사항
- production liveness/readiness와 PostgreSQL/S3 readiness를 추가했습니다.
- immutable release artifact, candidate validation, atomic PM2 switch를 추가했습니다.
- production deploy/rollback GitHub Actions와 release retention을 추가했습니다.

## 💡 변경 이유
- 운영 배포 실패가 현재 서비스에 영향을 주기 전에 candidate를 검증하고, application rollback을 재현 가능하게 만들기 위해서입니다.

## 🛠️ 구현 방법
- main SHA 기반 immutable release를 만들고 임시 loopback port에서 검증한 뒤 current symlink를 atomic하게 교체합니다.
- post-switch health 실패 시 이전 release를 복원하고 deployment 자체는 실패로 유지합니다.
- database migration은 forward-only이며 이전 application release와 호환되는 expand/contract 정책을 적용합니다.

## 📌 영향 범위
- health API
- private object storage readiness
- GitHub Actions production workflows
- Ubuntu/PM2 production runtime scripts
- release checklist

## ✅ 테스트
- pnpm typecheck
- pnpm verify:ops
- pnpm test
- real MinIO S3 integration
- pnpm build
- pnpm test:e2e

**테스트 결과 / 참고 사항**
- 실제 production deploy는 production secrets, host prerequisite, BloomBouquet callback 등록이 완료된 뒤 workflow_dispatch로 수행합니다.
- normal rollback은 database down migration을 수행하지 않습니다.

## 🌿 반영 브랜치
- main
```

Do not merge until PR CI is successful and the final changed-file security review finds no Critical/Important blocker.
