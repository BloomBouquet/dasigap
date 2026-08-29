# Production Release and Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed production release system for Dasigap with public liveness/readiness probes, immutable release artifacts, candidate validation, atomic PM2 selection, and application rollback.

**Architecture:** Keep the existing Next.js + Prisma application and Ubuntu/Nginx/PM2 host model. Build immutable releases from `main`, validate every candidate on a loopback-only temporary port, then atomically move the `current` symlink and reload PM2; if post-switch verification fails, restore the previous symlink and keep the deployment job failed. Database migrations are forward-only and must remain compatible with the immediately previous application release.

**Tech Stack:** Next.js 16 App Router, TypeScript 5.9, Prisma 6/PostgreSQL, Vitest 4, pnpm 11.24, GitHub Actions, Bash, PM2, Nginx, S3-compatible object storage with AWS SigV4.

**Spec:** `docs/superpowers/specs/2026-08-29-production-release-deploy-design.md`

## Global Constraints

- Production runtime is Node.js 22.
- Package manager is exactly `pnpm@11.24.0`; CI uses `pnpm install --frozen-lockfile`, while the server uses `pnpm install --frozen-lockfile --prod=false` because `prisma` is currently a devDependency required by `prisma generate` and `prisma migrate deploy` during release preparation.
- Production deployment stays on the existing Ubuntu + Nginx + PM2 operating model; no Docker/Kubernetes deployment layer is introduced.
- Release build, deploy, and rollback are manual `workflow_dispatch` operations; merging `main` does not automatically deploy.
- Repository code and GitHub artifacts must never contain `.env.production`, OAuth client secrets, PostgreSQL credentials, S3 credentials, or SSH private keys.
- Production SSH host verification uses the pinned `PRODUCTION_KNOWN_HOSTS` secret; runtime `ssh-keyscan` and `StrictHostKeyChecking=no` are forbidden.
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

- `src/health/release.ts` — validate/read release SHA.
- `src/health/readiness.ts` — bounded database/storage dependency readiness.
- `src/health/readiness.test.ts` — readiness orchestration unit tests.
- `app/api/health/live/route.ts` — public liveness endpoint.
- `app/api/health/ready/route.ts` — public readiness endpoint.
- `tests/integration/health-api.test.ts` — route contract tests.
- `src/documents/storage.ts` — add non-mutating signed S3 bucket readiness probe using existing storage configuration/signing boundary.
- `tests/integration/s3-storage.test.ts` — real MinIO readiness coverage.
- `ops/release/create-artifact.mjs` — validate SHA, write release metadata, package explicit allowlist.
- `ops/release/create-artifact.test.ts` — metadata/package policy tests.
- `ops/release/validate-artifact.mjs` — validate downloaded artifact metadata/archive before SSH.
- `ops/release/validate-artifact.test.ts` — artifact rejection tests.
- `ops/release/common.sh` — SHA/path validation, metadata validation, atomic links, health polling.
- `ops/release/prepare-release.sh` — exact dependency install, Prisma generate/migrate, immutable release placement.
- `ops/release/validate-candidate.sh` — temporary loopback process and exact-SHA live/ready validation.
- `ops/release/switch-release.sh` — candidate gate, atomic switch, PM2 reload, post-switch verification, automatic application rollback, successful-release cleanup.
- `ops/release/rollback-release.sh` — installed target validation, candidate gate, atomic manual rollback, no migration.
- `ops/release/cleanup-releases.sh` — preserve current/previous + three newest extras.
- `ops/pm2/ecosystem.config.cjs` — tracked runtime configuration; secrets remain host-only.
- `tests/ops/release-scripts.test.ts` — temp-filesystem release-script tests using stub binaries.
- `tests/ops/workflows.test.ts` — production workflow security/static invariants.
- `.github/workflows/build-production-release.yml` — manual verified release build from `main`.
- `.github/workflows/deploy-production-release.yml` — manual artifact deployment.
- `.github/workflows/rollback-production-release.yml` — manual installed-release rollback.
- `.github/workflows/ci.yml` — preserve all existing gates and add ops verification.
- `package.json` — focused ops verification scripts.
- `.env.example` — non-secret operational defaults only.
- `docs/release/mvp-checklist.md` — exact first-production rollout/smoke/rollback requirements.

---

### Task 1: Release Identity and Liveness

**Files:**
- Create: `src/health/release.ts`
- Create: `app/api/health/live/route.ts`
- Create: `tests/integration/health-api.test.ts`

**Interfaces:**
- Produces `getReleaseSha(env?: NodeJS.ProcessEnv): string`.
- Produces App Router `GET()` for `/api/health/live`.

- [ ] **Step 1: Write the failing liveness tests**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getLive } from "../../app/api/health/live/route";

describe("health API", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns liveness with the release SHA and no-store", async () => {
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

  it("uses unknown for a missing or invalid release SHA", async () => {
    vi.stubEnv("DASIGAP_RELEASE_SHA", "not-a-sha");
    const response = await getLive();
    expect((await response.json()).release).toBe("unknown");
  });
});
```

- [ ] **Step 2: Verify RED**

Run `pnpm exec vitest run tests/integration/health-api.test.ts`.

Expected: module-not-found failure for the liveness route.

- [ ] **Step 3: Implement release identity and liveness**

`src/health/release.ts`:

```ts
const FULL_SHA = /^[0-9a-f]{40}$/i;

export function getReleaseSha(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.DASIGAP_RELEASE_SHA?.trim();
  return value && FULL_SHA.test(value) ? value.toLowerCase() : "unknown";
}
```

`app/api/health/live/route.ts`:

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

The route must not import auth, Prisma, or storage.

- [ ] **Step 4: Verify GREEN and commit**

```bash
pnpm exec vitest run tests/integration/health-api.test.ts
pnpm typecheck
git add src/health/release.ts app/api/health/live/route.ts tests/integration/health-api.test.ts
git commit -m "feat: add production liveness endpoint"
```

Expected: tests/typecheck pass.

---

### Task 2: PostgreSQL and S3 Readiness

**Files:**
- Create: `src/health/readiness.ts`
- Create: `src/health/readiness.test.ts`
- Create: `app/api/health/ready/route.ts`
- Modify: `src/documents/storage.ts`
- Modify: `tests/integration/s3-storage.test.ts`
- Modify: `tests/integration/health-api.test.ts`

**Interfaces:**
- Produces `checkObjectStorageReadiness(options?: { timeoutMs?: number }): Promise<boolean>`.
- Produces `checkReadiness(deps?: ReadinessDependencies): Promise<boolean>`.
- Produces App Router `GET()` for `/api/health/ready`.

- [ ] **Step 1: Write RED readiness tests**

`src/health/readiness.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { checkReadiness } from "./readiness";

describe("checkReadiness", () => {
  it("requires both dependencies", async () => {
    const database = vi.fn().mockResolvedValue(true);
    const storage = vi.fn().mockResolvedValue(true);
    await expect(checkReadiness({ database, storage, timeoutMs: 100 })).resolves.toBe(true);
    await expect(checkReadiness({
      database: vi.fn().mockResolvedValue(false),
      storage,
      timeoutMs: 100,
    })).resolves.toBe(false);
  });

  it("fails closed on timeout", async () => {
    const never = () => new Promise<boolean>(() => undefined);
    await expect(checkReadiness({ database: never, storage: never, timeoutMs: 10 })).resolves.toBe(false);
  });
});
```

Extend `tests/integration/s3-storage.test.ts` import with `checkObjectStorageReadiness`, then add:

```ts
it("proves the configured private bucket is reachable without mutation", async () => {
  await expect(checkObjectStorageReadiness({ timeoutMs: 2_000 })).resolves.toBe(true);
});
```

- [ ] **Step 2: Verify RED**

Run `pnpm exec vitest run src/health/readiness.test.ts tests/integration/s3-storage.test.ts`.

Expected: missing-export/module failures.

- [ ] **Step 3: Add non-mutating signed S3 HEAD readiness**

In `src/documents/storage.ts`, extend the existing internal request method union to include `HEAD`. Keep the current configuration parser, bucket URL builder, and SigV4 implementation as the single source of storage credentials.

Add:

```ts
export async function checkObjectStorageReadiness(
  { timeoutMs = 2_000 }: { timeoutMs?: number } = {},
): Promise<boolean> {
  try {
    const config = requireConfiguration();
    const url = objectUrl(config, "");
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

Verify the canonical bucket path against the existing MinIO integration; preserve the trailing slash if the existing `objectUrl(config, "")` signer expects it.

- [ ] **Step 4: Implement database/storage orchestration**

`src/health/readiness.ts`:

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

async function bounded(value: Promise<boolean>, timeoutMs: number): Promise<boolean> {
  return Promise.race([
    value.catch(() => false),
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
    bounded(deps.database(), deps.timeoutMs),
    bounded(deps.storage(), deps.timeoutMs),
  ]);
  return database && storage;
}
```

- [ ] **Step 5: Add readiness HTTP route and complete contract tests**

`app/api/health/ready/route.ts`:

```ts
import { NextResponse } from "next/server";
import { checkReadiness } from "../../../../src/health/readiness";
import { getReleaseSha } from "../../../../src/health/release";

export async function GET() {
  const ready = await checkReadiness();
  return NextResponse.json(
    { status: ready ? "ready" : "not_ready", service: "dasigap", release: getReleaseSha() },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
```

In `tests/integration/health-api.test.ts`, use `vi.mock("../../src/health/readiness", ...)` before dynamically importing the ready route. Assert 200/`ready` and 503/`not_ready`; stringify the failure body and assert it does not contain `DATABASE_URL`, `OBJECT_STORAGE_ENDPOINT`, `postgresql://`, or `dasigap-ci-secret`.

- [ ] **Step 6: Verify with real MinIO and commit**

Use the existing CI MinIO startup command, then run:

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
git add src/health app/api/health src/documents/storage.ts tests/integration/health-api.test.ts tests/integration/s3-storage.test.ts
git commit -m "feat: add production readiness checks"
```

Expected: all focused checks pass.

---

### Task 3: Immutable Production Artifact

**Files:**
- Create: `ops/release/create-artifact.mjs`
- Create: `ops/release/create-artifact.test.ts`
- Create: `.github/workflows/build-production-release.yml`
- Modify: `package.json`

**Interfaces:**
- CLI: `node ops/release/create-artifact.mjs <commit-sha> <output-dir>`.
- Artifact files: `release-metadata.json` and `dasigap-release-<sha>.tgz`.

- [ ] **Step 1: Write RED metadata tests**

```ts
import { describe, expect, it } from "vitest";
import { createReleaseMetadata, validateCommitSha } from "./create-artifact.mjs";

describe("production artifact metadata", () => {
  it("accepts only a full commit SHA", () => {
    expect(() => validateCommitSha("abc123")).toThrow("full commit SHA");
    expect(validateCommitSha("A".repeat(40))).toBe("a".repeat(40));
  });

  it("contains only immutable release identity", () => {
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

Run `pnpm exec vitest run ops/release/create-artifact.test.ts`; expect module-not-found RED.

- [ ] **Step 2: Implement metadata and explicit allowlist packaging**

The module must export:

```js
export function validateCommitSha(value) {
  if (!/^[0-9a-f]{40}$/i.test(value)) throw new Error("full commit SHA required");
  return value.toLowerCase();
}

export function createReleaseMetadata(commitSha, now = new Date()) {
  return {
    service: "dasigap",
    commitSha: validateCommitSha(commitSha),
    builtAt: now.toISOString(),
    nodeMajor: 22,
    packageManager: "pnpm@11.24.0",
  };
}
```

The CLI validates `.next` exists, writes root `release-metadata.json`, and runs `tar -czf` with this exact allowlist:

```js
const releasePaths = [
  ".next", "app", "components", "public", "src", "prisma", "ops",
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "next.config.ts",
  "release-metadata.json",
];
```

It then copies metadata into the output directory and deletes only the temporary root metadata file it created. It never packages `.` and never uses an `.env*` glob.

- [ ] **Step 3: Add build workflow from actual checked-out `main` SHA**

Create `.github/workflows/build-production-release.yml`. Reuse the existing CI versions for Postgres 17, Node 22, pnpm 11.24, MinIO, and Playwright. The workflow must `actions/checkout@v6` with `ref: main`, then capture the actual checkout SHA:

```yaml
- name: Resolve release SHA
  id: release
  run: echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
```

Required sequence: frozen install → Prisma generate/validate/migrate → typecheck → `pnpm test` → existing real MinIO S3 integration → `pnpm build` → `pnpm test:e2e` → artifact script → upload.

Artifact upload must use:

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: dasigap-production-${{ steps.release.outputs.sha }}
    retention-days: 14
    if-no-files-found: error
    path: release-output/
```

- [ ] **Step 4: Verify artifact excludes secrets and commit**

Add package script:

```json
"verify:release-artifact": "vitest run ops/release/create-artifact.test.ts"
```

Run:

```bash
pnpm verify:release-artifact
pnpm build
rm -rf /tmp/dasigap-release-test
node ops/release/create-artifact.mjs "$(git rev-parse HEAD)" /tmp/dasigap-release-test
test -s /tmp/dasigap-release-test/release-metadata.json
test -s /tmp/dasigap-release-test/dasigap-release-$(git rev-parse HEAD).tgz
if tar -tzf /tmp/dasigap-release-test/dasigap-release-$(git rev-parse HEAD).tgz | grep -E '(^|/)\.env'; then exit 1; fi
git add ops/release/create-artifact.mjs ops/release/create-artifact.test.ts .github/workflows/build-production-release.yml package.json
git commit -m "feat: build immutable production releases"
```

Expected: all checks pass and archive contains no `.env` path.

---

### Task 4: Server Runtime, Candidate Gate, Atomic Switch, and Rollback Primitive

**Files:**
- Create: `ops/release/common.sh`
- Create: `ops/release/prepare-release.sh`
- Create: `ops/release/validate-candidate.sh`
- Create: `ops/release/switch-release.sh`
- Create: `ops/pm2/ecosystem.config.cjs`
- Create: `tests/ops/release-scripts.test.ts`
- Modify: `package.json`

**Interfaces:**
- `common.sh` exports `require_full_sha`, `release_path`, `read_release_sha`, `atomic_link`, `wait_for_health`, `restore_release`.
- Testability overrides: `PM2_BIN`, `CURL_BIN`, and `CANDIDATE_VALIDATOR` default to `pm2`, `curl`, and the tracked candidate script.
- `prepare-release.sh <staging-dir> <sha>` creates/reuses immutable release.
- `validate-candidate.sh <release-dir> <sha>` exits 0 only for exact-SHA live + ready success.
- `switch-release.sh <sha> <https-production-base-url>` switches only after candidate success and restores old `current` on post-switch failure.

- [ ] **Step 1: Write RED shell behavior tests with real temporary symlinks**

Create `tests/ops/release-scripts.test.ts` with these fixture helpers:

```ts
import { chmod, mkdir, mkdtemp, readlink, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
let root = "";
let bin = "";

async function executable(name: string, body: string) {
  const path = join(bin, name);
  await writeFile(path, `#!/usr/bin/env bash\nset -Eeuo pipefail\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

async function installed(sha: string) {
  const dir = join(root, "releases", sha);
  await mkdir(join(dir, "ops", "pm2"), { recursive: true });
  await writeFile(join(dir, "release-metadata.json"), JSON.stringify({ service: "dasigap", commitSha: sha }));
  await writeFile(join(dir, "ops", "pm2", "ecosystem.config.cjs"), "module.exports={apps:[]};\n");
  return dir;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dasigap-release-"));
  bin = join(root, "bin");
  await mkdir(join(root, "releases"), { recursive: true });
  await mkdir(join(root, "shared"), { recursive: true });
  await mkdir(bin);
  await writeFile(join(root, "shared", ".env.production"), "PORT=3000\n");
});
```

First RED test:

```ts
it("rejects traversal instead of constructing a release path", async () => {
  await expect(exec("bash", ["-c", `source ops/release/common.sh; release_path '../../etc/passwd'`], {
    env: { ...process.env, DASIGAP_ROOT: root },
  })).rejects.toMatchObject({ code: 64 });
});
```

Run `pnpm exec vitest run tests/ops/release-scripts.test.ts`; expect RED because scripts are missing.

- [ ] **Step 2: Implement fail-closed shared helpers**

`ops/release/common.sh` begins:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
DASIGAP_ROOT="${DASIGAP_ROOT:-/home/ubuntu/dasigap}"
DASIGAP_RELEASES="$DASIGAP_ROOT/releases"
DASIGAP_SHARED="$DASIGAP_ROOT/shared"
PM2_BIN="${PM2_BIN:-pm2}"
CURL_BIN="${CURL_BIN:-curl}"

require_full_sha() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid release sha" >&2; return 64; }
}

release_path() {
  require_full_sha "$1"
  printf '%s/%s\n' "$DASIGAP_RELEASES" "$1"
}

read_release_sha() {
  node -e 'const fs=require("node:fs"); const m=JSON.parse(fs.readFileSync(process.argv[1]+"/release-metadata.json","utf8")); if(m.service!=="dasigap"||!/^[0-9a-f]{40}$/.test(m.commitSha)) process.exit(65); process.stdout.write(m.commitSha)' "$1"
}

atomic_link() {
  local target="$1" link="$2" temp="${link}.tmp.$$"
  ln -s "$target" "$temp"
  mv -Tf "$temp" "$link"
}
```

`wait_for_health <url> <sha> <status>` performs at most 20 attempts with `--max-time 3`, pipes successful JSON to a Node one-liner that requires exact `status` and `release`, and sleeps 1 second between attempts. It never prints response bodies.

`restore_release <old-target>` atomically restores `current` and runs `$PM2_BIN startOrReload` using the restored release's tracked ecosystem file.

- [ ] **Step 3: Implement immutable preparation with dev tooling available**

`prepare-release.sh` validates `shared/.env.production`, sources it only after metadata/path validation, and runs:

```bash
pnpm install --frozen-lockfile --prod=false
pnpm db:generate
pnpm prisma migrate deploy
```

The explicit `--prod=false` is mandatory because production env may contain `NODE_ENV=production` while Prisma CLI is a devDependency. Move staging into `releases/<sha>` only after all three commands succeed. Reuse an existing release only if metadata matches exactly; never overwrite an existing release directory.

- [ ] **Step 4: Implement candidate validation**

`validate-candidate.sh` sources the host env, overrides only loopback host/port/release SHA, starts release-local Next, and traps cleanup:

```bash
HOSTNAME=127.0.0.1 PORT="${DASIGAP_CANDIDATE_PORT:-3101}" DASIGAP_RELEASE_SHA="$sha" \
  pnpm --dir "$release_dir" exec next start >"$candidate_log" 2>&1 &
candidate_pid=$!
trap 'kill "$candidate_pid" 2>/dev/null || true; wait "$candidate_pid" 2>/dev/null || true; rm -f "$candidate_log"' EXIT
wait_for_health "http://127.0.0.1:${DASIGAP_CANDIDATE_PORT:-3101}/api/health/live" "$sha" ok
wait_for_health "http://127.0.0.1:${DASIGAP_CANDIDATE_PORT:-3101}/api/health/ready" "$sha" ready
```

- [ ] **Step 5: Implement PM2 runtime**

`ops/pm2/ecosystem.config.cjs` loads `${DASIGAP_ROOT}/shared/.env.production` with Node 22 `process.loadEnvFile`, reads `${DASIGAP_ROOT}/current/release-metadata.json`, validates service/full SHA, and runs `${current}/node_modules/next/dist/bin/next start` with `HOSTNAME=127.0.0.1`, configured `PORT`, and metadata SHA as `DASIGAP_RELEASE_SHA`. No literal credentials are allowed in the tracked file.

- [ ] **Step 6: Implement switch + post-switch restore**

`switch-release.sh` validates HTTPS base URL with Node's `URL` parser before mutation. Sequence: validate SHA/metadata → candidate validate target → capture old current → set previous to old current → atomic current switch → PM2 reload → exact-SHA local live/ready → exact-SHA external HTTPS ready.

After `current` changes, any PM2/local/external failure calls `restore_release "$old"` when old exists and returns non-zero. First-deploy failure with no old release remains failed and does not fabricate rollback state.

- [ ] **Step 7: Complete GREEN atomic/restore tests**

Create stubs with the fixture helper:

```ts
const pm2 = await executable("pm2", `echo "$*" >> "${root}/pm2.log"`);
const candidateOk = await executable("candidate-ok", "exit 0");
const candidateFail = await executable("candidate-fail", "exit 9");
const curlFail = await executable("curl-fail", "exit 22");
```

For successful health, create a `curl-ok` stub per test with the expected SHA embedded in its script body so it outputs exact JSON for both `ok` and `ready` requests based on URL suffix. Tests assert invalid SHA exits 64; candidate failure preserves current; successful switch sets current target/previous old; post-switch failure restores old and exits non-zero. Inject `PM2_BIN`, `CURL_BIN`, and `CANDIDATE_VALIDATOR` through env so no real PM2/network is used.

- [ ] **Step 8: Verify and commit**

Add package scripts:

```json
"test:ops": "vitest run tests/ops/release-scripts.test.ts",
"check:ops": "bash -n ops/release/common.sh ops/release/prepare-release.sh ops/release/validate-candidate.sh ops/release/switch-release.sh"
```

Run:

```bash
pnpm test:ops
pnpm check:ops
pnpm typecheck
git add ops/release/common.sh ops/release/prepare-release.sh ops/release/validate-candidate.sh ops/release/switch-release.sh ops/pm2/ecosystem.config.cjs tests/ops/release-scripts.test.ts package.json
git commit -m "feat: add atomic production release switching"
```

Expected: GREEN.

---

### Task 5: Deploy Workflow and Downloaded Artifact Validation

**Files:**
- Create: `ops/release/validate-artifact.mjs`
- Create: `ops/release/validate-artifact.test.ts`
- Create: `tests/ops/workflows.test.ts`
- Create: `.github/workflows/deploy-production-release.yml`
- Modify: `package.json`

**Interfaces:**
- Workflow input `release_run_id`: digits only.
- Production secrets: `PRODUCTION_HOST`, `PRODUCTION_USER`, `PRODUCTION_SSH_KEY`, `PRODUCTION_KNOWN_HOSTS`, `PRODUCTION_BASE_URL`; optional `PRODUCTION_SSH_PORT` defaults to `22`.
- `validate-artifact.mjs <metadata> <archive>` prints validated SHA only.

- [ ] **Step 1: Write RED artifact validator test**

```ts
import { describe, expect, it } from "vitest";
import { validateArtifactMetadata } from "./validate-artifact.mjs";

describe("downloaded production artifact", () => {
  it("accepts only Dasigap metadata with a full SHA", () => {
    expect(validateArtifactMetadata({ service: "dasigap", commitSha: "a".repeat(40) })).toBe("a".repeat(40));
    expect(() => validateArtifactMetadata({ service: "other", commitSha: "a".repeat(40) })).toThrow();
    expect(() => validateArtifactMetadata({ service: "dasigap", commitSha: "../../etc" })).toThrow();
  });
});
```

Run `pnpm exec vitest run ops/release/validate-artifact.test.ts`; expect RED.

- [ ] **Step 2: Implement validator**

Export `validateArtifactMetadata(value)` and CLI behavior. Require `service === "dasigap"`, lowercase/full SHA, and `stat(archive).size > 0`. CLI stdout contains only SHA; errors go to stderr with generic messages.

- [ ] **Step 3: Create deploy workflow with run provenance gate**

Workflow skeleton:

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
jobs:
  deploy:
    environment: production
    runs-on: ubuntu-latest
    timeout-minutes: 20
    concurrency:
      group: dasigap-production-deploy
      cancel-in-progress: false
```

Before download, reject non-digits. Use `gh api repos/$GITHUB_REPOSITORY/actions/runs/$RUN_ID` and require `event == workflow_dispatch`, `conclusion == success`, and workflow identity/path equals `build-production-release.yml`. Check out `main`, fetch enough history, and require source run `head_sha` to be contained by `origin/main`.

Download via `actions/download-artifact@v4` using `run-id` and `github-token`; never accept caller-provided artifact names or server paths. Run `validate-artifact.mjs` and require validated SHA equals source run `head_sha`.

- [ ] **Step 4: Pin SSH trust and deploy through unique staging**

```bash
install -m 700 -d ~/.ssh
printf '%s\n' "$PRODUCTION_KNOWN_HOSTS" > ~/.ssh/known_hosts
chmod 600 ~/.ssh/known_hosts
printf '%s\n' "$PRODUCTION_SSH_KEY" > ~/.ssh/id_ed25519
chmod 600 ~/.ssh/id_ed25519
```

Validate `PRODUCTION_BASE_URL` with Node and require `https:`. Default SSH port with `${PRODUCTION_SSH_PORT:-22}`. Remote staging path is `/home/ubuntu/dasigap/.staging/<validated-sha>-<deploy-workflow-run-id>`. Upload metadata/archive with pinned-host `scp`; remote `bash -s --` receives only validated SHA, run ID, and HTTPS base URL as positional args, extracts under staging, verifies metadata again, runs staged `prepare-release.sh`, then installed `switch-release.sh`.

- [ ] **Step 5: Add deploy workflow static security test**

`tests/ops/workflows.test.ts` at this task contains only the deploy assertion:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production workflows", () => {
  it("deploy is manual, protected, serialized, and pins SSH trust", async () => {
    const yaml = await readFile(".github/workflows/deploy-production-release.yml", "utf8");
    expect(yaml).toContain("workflow_dispatch:");
    expect(yaml).toContain("environment: production");
    expect(yaml).toContain("group: dasigap-production-deploy");
    expect(yaml).toContain("cancel-in-progress: false");
    expect(yaml).toContain("PRODUCTION_KNOWN_HOSTS");
    expect(yaml).not.toContain("ssh-keyscan");
    expect(yaml).not.toContain("StrictHostKeyChecking=no");
    expect(yaml).not.toContain("git pull");
  });
});
```

- [ ] **Step 6: Verify and commit**

Add:

```json
"verify:deploy": "vitest run ops/release/validate-artifact.test.ts tests/ops/workflows.test.ts"
```

Run:

```bash
pnpm verify:deploy
pnpm check:ops
pnpm typecheck
git add ops/release/validate-artifact.mjs ops/release/validate-artifact.test.ts tests/ops/workflows.test.ts .github/workflows/deploy-production-release.yml package.json
git commit -m "feat: add production deployment workflow"
```

Expected: GREEN.

---

### Task 6: Manual Rollback, Retention, CI Gate, and Release Documentation

**Files:**
- Create: `ops/release/rollback-release.sh`
- Create: `ops/release/cleanup-releases.sh`
- Create: `.github/workflows/rollback-production-release.yml`
- Modify: `ops/release/switch-release.sh`
- Modify: `tests/ops/release-scripts.test.ts`
- Modify: `tests/ops/workflows.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `.env.example`
- Modify: `docs/release/mvp-checklist.md`
- Modify: `package.json`

**Interfaces:**
- Rollback input `target_sha`: exact full lowercase commit SHA already installed on server.
- `rollback-release.sh <target-sha> <https-production-base-url>` does not install dependencies or migrate DB.
- `cleanup-releases.sh` preserves resolved current, resolved previous, and three newest additional SHA directories.
- `switch-release.sh` invokes cleanup only after successful external readiness.

- [ ] **Step 1: Add RED manual rollback test**

Using Task 4 fixtures:

```ts
it("leaves current unchanged when rollback target candidate is unhealthy", async () => {
  const oldSha = "1".repeat(40);
  const targetSha = "2".repeat(40);
  const old = await installed(oldSha);
  await installed(targetSha);
  await symlink(old, join(root, "current"));
  const candidateFail = await executable("candidate-fail", "exit 9");
  await expect(exec("bash", ["ops/release/rollback-release.sh", targetSha, "https://dasigap.invalid"], {
    env: { ...process.env, DASIGAP_ROOT: root, CANDIDATE_VALIDATOR: candidateFail },
  })).rejects.toBeTruthy();
  expect(await readlink(join(root, "current"))).toBe(old);
});
```

Add a successful rollback test with candidate/curl/PM2 stubs and assert `current == target`, `previous == old`, and PM2 was invoked. Run `pnpm test:ops`; expect missing-script RED.

- [ ] **Step 2: Implement manual rollback using shared restore logic**

`rollback-release.sh` validates SHA/HTTPS base URL, requires installed metadata match, runs `${CANDIDATE_VALIDATOR:-$target/ops/release/validate-candidate.sh}` before link mutation, captures old current, atomically updates previous/current, reloads PM2, requires local/external exact-SHA readiness, and restores old current with `restore_release` on post-switch failure. It contains no `pnpm install`, `prisma generate`, or `prisma migrate deploy`.

- [ ] **Step 3: Implement safe retention and its deterministic test**

`cleanup-releases.sh` uses immediate children only, accepts directory names matching `^[0-9a-f]{40}$`, resolves current/previous, protects them plus the three newest remaining SHA directories by mtime, and removes only older validated immediate children.

Create six installed SHA fixtures, set mtimes with `utimes`, point current/previous to two of them, run cleanup, and assert exactly current + previous + three newest extras remain.

Modify successful `switch-release.sh` and `rollback-release.sh` to invoke cleanup only after external readiness succeeds. Cleanup failure emits a generic warning and does not fail a healthy deployment; cleanup never runs during failed recovery.

- [ ] **Step 4: Add rollback workflow and static assertion**

Workflow skeleton:

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

Validate full SHA and HTTPS base URL before SSH, configure the same pinned known-hosts setup as deploy, and invoke only the installed target rollback script. Workflow must contain no artifact download, package install, `git`, or Prisma migration.

Append to `tests/ops/workflows.test.ts`:

```ts
it("rollback is protected, serialized, and never migrates", async () => {
  const yaml = await readFile(".github/workflows/rollback-production-release.yml", "utf8");
  expect(yaml).toContain("workflow_dispatch:");
  expect(yaml).toContain("environment: production");
  expect(yaml).toContain("group: dasigap-production-deploy");
  expect(yaml).toContain("PRODUCTION_KNOWN_HOSTS");
  expect(yaml).not.toContain("prisma migrate");
  expect(yaml).not.toContain("pnpm install");
  expect(yaml).not.toContain("ssh-keyscan");
});
```

- [ ] **Step 5: Document safe settings and rollout gates**

Append to `.env.example`:

```dotenv
DASIGAP_RELEASE_SHA=
DASIGAP_ROOT=/home/ubuntu/dasigap
PORT=3000
DASIGAP_CANDIDATE_PORT=3101
```

Update `docs/release/mvp-checklist.md` to require: GitHub `production` environment/secrets; Node22/Corepack/pnpm/PM2/Nginx prerequisites; host-only `shared/.env.production`; exact HTTPS BloomBouquet callback registration; successful release build; successful deploy reporting exact SHA; browser auth/session/logout smoke; private document upload/read/delete smoke; manual rollback + forward deploy exercise; destructive/incompatible migration handled by separate approved operations plan.

- [ ] **Step 6: Wire ops gates into existing CI**

Package script:

```json
"verify:ops": "pnpm check:ops && vitest run tests/ops ops/release/create-artifact.test.ts ops/release/validate-artifact.test.ts"
```

Extend `check:ops` with rollback/cleanup scripts. Add after typecheck in `.github/workflows/ci.yml`:

```yaml
- name: Production operations verification
  run: pnpm verify:ops
```

Do not remove/relax existing Prisma, unit/integration/security, MinIO, build, or Playwright gates.

- [ ] **Step 7: Run full release gate**

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm prisma validate
pnpm prisma migrate deploy
pnpm typecheck
pnpm verify:ops
pnpm test
RUN_S3_INTEGRATION=1 \
OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000 \
OBJECT_STORAGE_REGION=us-east-1 \
OBJECT_STORAGE_BUCKET=dasigap-ci \
OBJECT_STORAGE_ACCESS_KEY_ID=dasigap-ci \
OBJECT_STORAGE_SECRET_ACCESS_KEY=dasigap-ci-secret \
pnpm exec vitest run tests/integration/s3-storage.test.ts
pnpm build
pnpm test:e2e
git diff --check
```

The real MinIO container/bucket must be started first using the exact existing CI commands. Expected: every command exits 0.

- [ ] **Step 8: Final security/migration review**

```bash
if grep -R "ssh-keyscan\|StrictHostKeyChecking=no\|git pull" .github/workflows ops; then exit 1; fi
if grep -n "prisma migrate\|pnpm install" ops/release/rollback-release.sh; then exit 1; fi
git diff main...HEAD -- prisma/migrations
git status --short
```

Expected: forbidden deployment patterns absent. If a migration appears in this branch, verify it is additive/backward-compatible with the immediately previous application release before PR.

- [ ] **Step 9: Commit final release gate**

```bash
git add ops/release/rollback-release.sh ops/release/cleanup-releases.sh ops/release/switch-release.sh .github/workflows/rollback-production-release.yml tests/ops .github/workflows/ci.yml .env.example docs/release/mvp-checklist.md package.json
git commit -m "feat: add production rollback release gate"
```

- [ ] **Step 10: Push, verify CI, and open PR**

PR title:

```text
feat : 운영 배포 및 롤백 파이프라인 구축
```

PR body:

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

Do not merge until PR CI succeeds and a final changed-file security review finds no Critical/Important blocker.
