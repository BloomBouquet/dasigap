# Production Release, Health, Deploy, and Rollback Design

Date: 2026-08-29
Project: Dasigap
Target branch: `main`
Implementation branch: `dasigap/devops-production-release`

## 1. Goal

Add a production release pipeline for Dasigap that can verify a release, package it, deploy it to the existing Ubuntu + Nginx + PM2 operating model, prove the candidate is healthy before traffic switch, and roll back to a previously installed application release without rebuilding or changing database history.

The deployment system must fail closed. A failed candidate health check, missing production secret, invalid release artifact, failed migration, or failed post-switch health check must never leave a partially selected release as the intended production version.

## 2. Current context

Dasigap is a Next.js 16 application using pnpm, Prisma/PostgreSQL, BloomBouquet SSO, and private S3-compatible object storage. The repository currently has a comprehensive CI workflow but no production release or deployment workflow.

The existing CI already verifies frozen dependency installation, Prisma client/schema/migrations, TypeScript, unit/integration/security tests, a real MinIO S3-compatible integration, production build, and Playwright release E2E.

BloomBouquet projects already use a separate manually dispatched production release build workflow. Dasigap should follow the same separation between normal CI and production release operations rather than turning every merge into an automatic deployment.

## 3. Scope

### In scope

- Public liveness endpoint.
- Public readiness endpoint.
- PostgreSQL readiness probe.
- Non-destructive private object storage readiness probe.
- Immutable release metadata tied to a Git commit SHA.
- Manually dispatched production release build artifact.
- Manually dispatched production deployment using a previously built artifact.
- Candidate process validation on a temporary local port before traffic switch.
- Atomic `current` symlink switch.
- PM2 production process reload.
- Production URL post-switch health verification.
- Automatic application rollback if post-switch verification fails.
- Manual rollback workflow to a previously installed release SHA.
- Release retention policy.
- Production environment and secret contract documentation.
- Migration compatibility rules for application rollback safety.

### Out of scope

- Provisioning the Ubuntu host itself.
- Provisioning PostgreSQL or object storage.
- Provisioning DNS or TLS certificates.
- Creating or modifying the central BloomBouquet OAuth client registration.
- Hard-coding a production domain into the repository.
- Dockerizing the application.
- Kubernetes, blue/green clusters, or multi-host orchestration.
- Automatic database schema rollback.
- Restoring database data from backups.
- Zero-downtime database migration tooling beyond backward-compatible migration policy.
- Automatic deployment on every `main` merge.

## 4. Chosen architecture

Use immutable filesystem releases on the existing Ubuntu host.

Server layout:

```text
/home/ubuntu/dasigap/
  current -> /home/ubuntu/dasigap/releases/<commit-sha>
  previous -> /home/ubuntu/dasigap/releases/<previous-commit-sha>
  releases/
    <commit-sha>/
      .next/
      app/
      components/
      prisma/
      public/
      src/
      ops/
      package.json
      pnpm-lock.yaml
      pnpm-workspace.yaml
      next.config.ts
      release-metadata.json
      node_modules/
  shared/
    .env.production
```

The exact root is configurable through `DASIGAP_ROOT` in server-side deployment scripts, with `/home/ubuntu/dasigap` as the approved default.

The repository does not contain production secrets. `shared/.env.production` exists only on the production host and is never packaged into a GitHub artifact.

Nginx continues to proxy the selected production hostname to the stable application port, default `127.0.0.1:3000`.

## 5. Why this architecture

This approach fits the existing host model without adding a container registry or new orchestration layer. Each release has a stable commit identity and filesystem path, so an application rollback is a symlink operation plus a PM2 reload rather than a rebuild.

A plain `git pull && build && restart` strategy is rejected because it mutates the active working tree in place and makes rollback dependent on repository state and another successful build.

A Docker/GHCR design is technically sound but rejected for this iteration because it would add image build, registry, Compose, migration container, image pruning, and image rollback operations at the same time as the first production deployment subsystem.

## 6. Health endpoints

### 6.1 `GET /api/health/live`

Purpose: prove that the Next.js process can accept HTTP requests.

Behavior:

- Does not require authentication.
- Does not access the database.
- Does not access object storage.
- Always uses `Cache-Control: no-store`.
- Returns HTTP 200 while the process is responsive.
- Returns only non-sensitive service metadata.

Success response shape:

```json
{
  "status": "ok",
  "service": "dasigap",
  "release": "<commit-sha-or-unknown>"
}
```

`DASIGAP_RELEASE_SHA` supplies the release value in production. `unknown` is allowed in local development and test environments.

Liveness must not fail merely because a dependency is unavailable. Dependency availability belongs to readiness.

### 6.2 `GET /api/health/ready`

Purpose: prove that the release can serve production traffic that depends on required backing services.

Behavior:

- Does not require authentication.
- Uses `Cache-Control: no-store`.
- Checks PostgreSQL using a minimal `SELECT 1` style query.
- Checks private object storage using an authenticated, non-mutating bucket-level `HEAD` request against the configured S3-compatible service.
- Each dependency probe has a bounded timeout.
- Does not expose hostnames, credentials, bucket names, SQL errors, stack traces, or user data.
- Returns HTTP 200 only when all required readiness checks succeed.
- Returns HTTP 503 if any required check fails or production storage configuration is invalid.

Success:

```json
{
  "status": "ready",
  "service": "dasigap",
  "release": "<commit-sha-or-unknown>"
}
```

Failure:

```json
{
  "status": "not_ready",
  "service": "dasigap",
  "release": "<commit-sha-or-unknown>"
}
```

Detailed dependency errors are server-log concerns and are not returned to unauthenticated clients.

## 7. Object storage readiness

The current object storage implementation already owns S3-compatible configuration and SigV4 signing. Readiness should extend that boundary rather than duplicating credential parsing in the health route.

Add a storage readiness function that:

1. Uses the existing production storage configuration validation.
2. Constructs the configured bucket URL.
3. Signs a `HEAD` request with AWS SigV4.
4. Sends no request body and creates, changes, or deletes no objects.
5. Uses a short timeout.
6. Returns success/failure without returning credentials or raw provider errors.

The MinIO CI service must exercise this probe so the implementation is verified against a real S3-compatible server rather than only mocked fetch calls.

## 8. Release artifact

Add a manually dispatched workflow named `Build production release`.

The workflow must check out `main`, not an arbitrary caller branch.

Required sequence:

1. Check out `main`.
2. Set up the repository's supported Node 22 runtime.
3. Enable the pinned pnpm version.
4. `pnpm install --frozen-lockfile`.
5. `pnpm prisma generate`.
6. `pnpm prisma validate`.
7. Run the repository test suite.
8. Run the existing real MinIO integration.
9. Run `pnpm build`.
10. Create immutable `release-metadata.json`.
11. Create a compressed release payload.
12. Upload the payload and metadata as a GitHub Actions artifact.

The release metadata contains only non-secret release identity data:

```json
{
  "service": "dasigap",
  "commitSha": "<40-char-sha>",
  "builtAt": "<ISO-8601 UTC>",
  "nodeMajor": 22,
  "packageManager": "pnpm@11.24.0"
}
```

Artifact naming:

```text
dasigap-production-<commit-sha>
```

Artifact retention: 14 days in GitHub Actions. Installed server releases follow a separate retention policy and are not tied to Actions artifact expiry.

The payload includes everything necessary to reproduce the already-built application on the server, except secrets and `node_modules`.

It includes at least:

- `.next/`
- `app/`
- `components/`
- `public/`
- `src/`
- `prisma/`
- `ops/`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `next.config.ts`
- `release-metadata.json`

It excludes `.env*`, test artifacts, Playwright browser binaries, Git metadata, and local caches.

## 9. Production environment contract

The deployment and rollback workflows use a GitHub Environment named `production` so repository environment protection rules can be enabled later without redesigning the workflows.

Required GitHub `production` secrets:

- `PRODUCTION_HOST`
- `PRODUCTION_USER`
- `PRODUCTION_SSH_KEY`
- `PRODUCTION_KNOWN_HOSTS`
- `PRODUCTION_BASE_URL`

Optional secret:

- `PRODUCTION_SSH_PORT`; defaults to `22` when absent.

`PRODUCTION_KNOWN_HOSTS` is mandatory rather than using runtime `ssh-keyscan`. The workflow must pin the expected server host key and fail if it does not match.

Required host prerequisites:

- Node.js 22.
- Corepack/pnpm capable of running the repository-pinned pnpm version.
- PM2 installed and available to the deployment user.
- Nginx already proxying the chosen HTTPS production hostname to the production app port.
- `shared/.env.production` readable only by the deployment/runtime user.
- PostgreSQL reachable from the host.
- S3-compatible private object storage reachable from the host.
- BloomBouquet production OAuth client already configured for the chosen HTTPS callback URI before production login is expected to work.

## 10. Production runtime configuration

Add a tracked PM2 ecosystem configuration under `ops/pm2/`.

The PM2 application name is `dasigap`.

Default production port is `3000`, configurable with `PORT` in the host environment file.

The PM2 configuration:

- Resolves the root from `DASIGAP_ROOT` or `/home/ubuntu/dasigap`.
- Uses the `current` symlink as the working directory.
- Loads production variables from `shared/.env.production` using Node 22 environment-file support or `process.loadEnvFile`.
- Reads `current/release-metadata.json` and exposes its `commitSha` as `DASIGAP_RELEASE_SHA`.
- Runs the local Next.js runtime from the selected release.
- Uses restart limits appropriate for a web service.
- Does not embed secrets in the tracked ecosystem file.

## 11. Deployment workflow

Add a manually dispatched workflow named `Deploy production release`.

Input:

- `release_run_id`: GitHub Actions run ID of a successful `Build production release` workflow.

The deploy workflow uses `environment: production` and a concurrency group such as `dasigap-production-deploy` with `cancel-in-progress: false`.

### 11.1 Artifact validation

Before SSH:

1. Download the artifact associated with `release_run_id`.
2. Parse `release-metadata.json`.
3. Require `service === "dasigap"`.
4. Require a full 40-character Git commit SHA.
5. Verify the SHA is contained in `main` history.
6. Verify the compressed payload exists and is non-empty.
7. Never accept a caller-supplied path or arbitrary artifact name as a server destination.

### 11.2 Upload and release preparation

Server target:

```text
$DASIGAP_ROOT/releases/<commit-sha>
```

If that directory already exists, deployment treats it as an immutable release. It may reuse it only when its `release-metadata.json` matches the requested commit SHA exactly. It must not overwrite an existing release directory with different contents.

For a new release:

1. Upload into a temporary directory under the root.
2. Extract the payload there.
3. Verify release metadata again on the server.
4. Run `pnpm install --frozen-lockfile` in the release directory.
5. Run `pnpm prisma generate`.
6. Run `pnpm prisma migrate deploy` using production database configuration.
7. Rename the prepared directory to `releases/<commit-sha>` only after preparation succeeds.

The server never performs `git pull` and does not need a Git checkout.

## 12. Candidate validation before traffic switch

A prepared release is not selected immediately.

The deploy script starts the release as a temporary candidate process on a loopback-only candidate port. Default candidate port: `3101`.

Candidate startup uses the same `shared/.env.production` as production and overrides only:

- `PORT=<candidate-port>`
- `DASIGAP_RELEASE_SHA=<candidate-sha>`

Validation sequence:

1. Start candidate process bound to loopback.
2. Poll `http://127.0.0.1:<candidate-port>/api/health/live` with a bounded retry window.
3. Poll `http://127.0.0.1:<candidate-port>/api/health/ready` with a bounded retry window.
4. Require HTTP 200 from both.
5. Require the returned `release` value to equal the candidate commit SHA.
6. Stop the temporary candidate process in both success and failure paths.

If candidate validation fails, deployment stops before `current` changes.

## 13. Atomic application switch

After candidate validation succeeds:

1. Resolve the existing `current` symlink target, if present.
2. Record it as the rollback target.
3. Update `previous` atomically to the old `current` release when one exists.
4. Create a temporary symlink to the candidate release.
5. Atomically rename the temporary symlink to `current`.
6. Run PM2 `startOrReload`/equivalent using the tracked ecosystem file with updated environment.
7. Verify local production-port liveness/readiness.
8. Verify the external HTTPS `PRODUCTION_BASE_URL/api/health/ready` through Nginx/TLS.
9. Require the external response release SHA to equal the candidate SHA.

The symlink switch must use same-filesystem rename semantics. It must not remove `current` and leave a gap before creating the new link.

## 14. Automatic rollback on failed post-switch verification

If the application was switched but local or external post-switch verification fails:

1. If an old release existed, atomically restore `current` to that release.
2. Reload PM2 against the restored `current` release.
3. Verify restored local liveness/readiness.
4. Verify external readiness when possible.
5. Mark the GitHub Actions deployment job failed even if rollback succeeds.

A failed deployment is never reported as success merely because rollback succeeded.

If there was no previous release, the workflow cannot fabricate one. It must report first-deploy failure explicitly and leave diagnostic evidence in the action logs without printing secrets.

## 15. Manual rollback workflow

Add a manually dispatched workflow named `Rollback production release`.

Input:

- `target_sha`: exact full commit SHA of an already installed server release.

Rules:

- Uses `environment: production`.
- Uses the same production concurrency group as deploy.
- Does not download or rebuild an artifact.
- Does not run reverse database migrations.
- Requires `$DASIGAP_ROOT/releases/<target_sha>/release-metadata.json` to exist and match `target_sha`.
- Candidate-validates the target release on the temporary port before selecting it.
- Atomically changes `current` to the target release.
- Sets `previous` to the formerly selected release when appropriate.
- Reloads PM2.
- Performs local and external readiness checks.
- If the requested rollback release itself fails validation, leaves the current release untouched.

## 16. Database migration policy

Application release rollback and database schema rollback are different operations.

`prisma migrate deploy` is allowed during release preparation, but the deployment system never runs a down migration.

Therefore any migration included in a normal Dasigap production release must be compatible with both:

- the new application release, and
- the immediately previous production application release.

Normal production releases should prefer expand/contract sequencing:

1. Add new nullable columns/tables/indexes or otherwise backward-compatible schema.
2. Deploy application code that can work with the expanded schema.
3. Stop old code from depending on fields scheduled for removal.
4. Remove incompatible schema only in a later separately reviewed migration after rollback compatibility is no longer required.

Destructive or immediately incompatible migrations are outside the standard deployment path and require a separate approved operations plan.

## 17. Release retention

Keep at least:

- the active `current` release,
- the `previous` release,
- and the three most recent additional installed releases.

A cleanup step may delete older release directories only after successful post-switch verification.

Cleanup must never delete the paths currently referenced by `current` or `previous`.

GitHub artifact retention remains 14 days and is independent from installed server release retention.

## 18. Failure semantics

### Build failure

No production artifact is published.

### Artifact validation failure

No SSH deployment begins.

### Upload or dependency installation failure

No `current` change.

### Migration failure

No `current` change.

### Candidate liveness/readiness failure

No `current` change.

### PM2 reload failure after switch

Attempt automatic application rollback to the old release and fail the deployment job.

### External Nginx/TLS health failure after switch

Attempt automatic application rollback to the old release and fail the deployment job.

### Rollback target validation failure

Leave the current release untouched and fail the rollback job.

## 19. Security requirements

- Production `.env` files are never stored in Git or GitHub artifacts.
- SSH private keys are GitHub Environment secrets only.
- Known-host verification is pinned; no blind `ssh-keyscan` trust-on-first-use in production workflows.
- Deployment scripts use strict shell mode.
- Release SHA is validated before using it in filesystem paths.
- User-controlled strings are never interpolated into arbitrary remote shell paths.
- Health endpoints expose no secrets or raw dependency errors.
- Health endpoints do not require user authentication, so infrastructure probes do not depend on OAuth availability.
- Candidate port binds to loopback and is not an Internet-facing service.
- Production dev authentication remains prohibited by the existing auth boundary.
- Release artifacts never contain object-storage credentials, database URLs, Bouquet credentials, or session material.

## 20. Testing strategy

Implementation follows TDD where practical.

### Unit/integration tests

- Liveness returns expected non-sensitive payload.
- Readiness returns 200 when DB and object storage are healthy.
- Readiness returns 503 when DB fails.
- Readiness returns 503 when object storage configuration/connectivity fails.
- Object storage HEAD readiness succeeds against CI MinIO.
- Health routes never return credential/configuration strings.
- Release metadata validation accepts valid metadata and rejects malformed service/SHA values.
- Server release path validation accepts only full SHA-derived paths.

### Workflow/static tests

Add repository tests that parse/check the workflow and ops files for required safety invariants where useful, including:

- production workflows are manual.
- deploy/rollback use the `production` environment.
- deploy and rollback share a non-cancelling concurrency group.
- deploy does not perform `git pull` on the server.
- rollback does not run reverse migrations.
- known-host secret is required.

### Existing release gate

The existing CI remains required and must continue to pass:

- frozen pnpm install,
- Prisma generate/validate/migrate,
- typecheck,
- unit/integration/security tests,
- real MinIO S3 integration,
- production build,
- full Playwright E2E.

## 21. Expected repository additions

The implementation is expected to add or modify files in these areas:

```text
app/api/health/live/route.ts
app/api/health/ready/route.ts
src/health/
src/documents/storage.ts
.github/workflows/build-production-release.yml
.github/workflows/deploy-production.yml
.github/workflows/rollback-production.yml
ops/deploy/
ops/pm2/
docs/release/
package.json
```

Exact file decomposition is decided in the implementation plan, but health logic, release validation, and shell orchestration should remain in focused units rather than one large workflow script.

## 22. Acceptance criteria

The feature is complete when all of the following are true:

1. `/api/health/live` reports process liveness without dependency access.
2. `/api/health/ready` verifies PostgreSQL and S3-compatible object storage non-destructively.
3. CI verifies the object storage readiness probe against MinIO.
4. A manually dispatched build workflow creates a commit-addressed release artifact from `main` only.
5. The artifact contains no production secrets.
6. A deploy workflow can prepare an immutable server release from that artifact.
7. Database migrations run before traffic switch.
8. A candidate process passes local liveness/readiness before `current` changes.
9. `current` switches atomically to the candidate release.
10. PM2 reloads the selected release.
11. Local production-port and external Nginx/TLS readiness are checked after switch.
12. A failed post-switch verification automatically restores the previous application release when available.
13. A manual rollback can select an already installed release without rebuilding or reversing database migrations.
14. Deploy and rollback cannot run concurrently.
15. Current and previous releases are protected from cleanup.
16. Existing CI and application E2E suites remain green.
17. Deployment documentation lists every external prerequisite and secret without hard-coding a production domain or credential.

## 23. Rollout prerequisites

Merging this subsystem does not itself mean Dasigap is live in production.

The first real production deployment remains blocked until all of these external prerequisites are satisfied:

- production hostname and TLS are configured in Nginx,
- production PostgreSQL is provisioned and `DATABASE_URL` is present on the host,
- production private S3-compatible object storage is provisioned and configured on the host,
- BloomBouquet has the Dasigap production client ID and exact HTTPS callback URI registered,
- `shared/.env.production` contains the production runtime configuration,
- GitHub `production` Environment contains the required SSH/base-URL secrets,
- PM2 and Node 22 are installed on the target host,
- a first production release artifact has passed the full build workflow.

No development-auth fallback is permitted if any production authentication prerequisite is missing.
