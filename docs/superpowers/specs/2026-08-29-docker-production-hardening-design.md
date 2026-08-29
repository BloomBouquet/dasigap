# Docker Production Hardening Design

Date: 2026-08-29
Status: Approved design, implementation not started
Target branch: `dasigap/docker-production-hardening`
Base: `main` at `bc448ac5311a9d602c494c79b5cda7581e258120`

## 1. Purpose

Harden the production deployment path that already exists on `main` without introducing a second deployment system.

The repository already has:

- a standalone production Docker runtime image;
- a separate Prisma migrator image;
- immutable GHCR tags (`sha-<commit>` and `migrate-sha-<commit>`);
- a manual production deployment workflow with pinned SSH host verification;
- a loopback-only production Compose service;
- application-only rollback that intentionally does not downgrade database migrations.

This design keeps those choices and adds missing release identity, dependency readiness, candidate validation, and automatic application restoration around them.

## 2. Non-goals

This work does not introduce:

- PM2;
- tarball release artifacts;
- `/home/ubuntu/dasigap/releases/<sha>` symlink releases;
- Docker Swarm or Kubernetes;
- automatic database downgrade;
- zero-downtime multi-node orchestration;
- a second production deployment workflow unrelated to the existing Docker/GHCR path;
- production domain, OAuth client, database, or object-storage credentials in the repository.

The superseded branch `dasigap/devops-production-release` remains unmerged and is not deleted by this work.

## 3. Current gaps

The current Docker deployment is a valid baseline but does not yet satisfy the stronger production release contract:

1. `/api/health` reports only `{ "status": "ok" }`; it does not identify the running release.
2. There is no readiness endpoint covering PostgreSQL and private object storage.
3. `deploy/deploy.sh` applies migrations and immediately recreates the production `dasigap` container before validating the new runtime as a candidate.
4. A failed post-replacement health check stops the failed application but does not automatically recreate the previous application image.
5. `deploy/rollback.sh` also replaces production before candidate validation.
6. Existing health checks can prove that a process responds, but not that the expected immutable SHA is the process that responded.

## 4. Release identity

### 4.1 Runtime image contract

The production runtime image receives the exact 40-character lowercase Git commit SHA through a Docker build argument named `RELEASE_SHA`.

The runner stage exposes it as an image environment value. Production image workflows must pass `${{ github.sha }}` when building both smoke and publish runtime images.

The runtime application treats a missing or malformed release SHA as `unknown` outside the immutable production build path, so local development remains usable. Production deployment verification, however, requires an exact 40-character SHA match and fails closed otherwise.

### 4.2 Health response contract

`GET /api/health/live`

- purpose: process liveness only;
- success: HTTP 200;
- body: `{ "status": "ok", "release": "<sha-or-unknown>" }`;
- no database or object-storage access;
- `Cache-Control: no-store`.

`GET /api/health/ready`

- purpose: dependency readiness;
- probes PostgreSQL and private object storage;
- success: HTTP 200 with `{ "status": "ready", "release": "<sha-or-unknown>" }`;
- dependency failure: HTTP 503 with `{ "status": "unavailable", "release": "<sha-or-unknown>" }`;
- does not expose which dependency failed, credentials, endpoints, bucket names, SQL errors, or provider error bodies;
- `Cache-Control: no-store`.

The existing `GET /api/health` remains as a compatibility liveness alias during this change so the currently shipped Docker image contract is not broken abruptly. New Docker and deployment checks use `/api/health/live` and `/api/health/ready`.

## 5. Readiness probes

### 5.1 PostgreSQL

Readiness runs a minimal non-mutating connectivity query such as `SELECT 1` through the existing Prisma client.

The probe has a bounded timeout and converts synchronous throws, rejected promises, and timeouts into a readiness failure. Detailed database errors are not returned to clients.

### 5.2 Object storage

Readiness performs a non-mutating authenticated `HEAD` request against the configured S3-compatible bucket/root resource using the repository's existing AWS SigV4 implementation.

The probe must not create, upload, overwrite, or delete any object. Existing signed PUT/DELETE/GET behavior must remain unchanged.

A bounded timeout applies. Provider error details remain server-side and are not included in public health responses.

## 6. Production image workflow

The existing `Production Image` workflow remains the only image build/publish path.

It is hardened as follows:

1. Build runtime image with `RELEASE_SHA=${{ github.sha }}`.
2. Smoke-test `/api/health/live` and require the returned release to equal `${{ github.sha }}`.
3. Keep migrator smoke testing against PostgreSQL.
4. On `main` push, publish immutable runtime `sha-${{ github.sha }}` and immutable migrator `migrate-sha-${{ github.sha }}`.
5. `latest` may remain a convenience tag but production deployment never selects it.

The deploy workflow accepts only a full lowercase SHA reachable from `main`.

## 7. Deployment state machine

### 7.1 Preconditions

Before changing production application state:

- validate the requested full SHA;
- verify the SHA is reachable from `main` in GitHub Actions;
- use pinned `known_hosts` with `StrictHostKeyChecking=yes`;
- pull the immutable runtime and matching migrator images;
- require the server production env file to be readable;
- record the currently running immutable application image, if one exists.

### 7.2 Migration phase

Run `migrate-sha-<sha>` exactly once for the requested release before runtime candidate validation.

If migration fails:

- do not create or replace the production runtime container;
- leave the current application container unchanged;
- fail the deployment.

Database migrations are forward-only. Automatic application rollback never attempts to reverse a successful migration.

Production schema changes therefore follow expand/contract compatibility: the previous application version must remain compatible with the newly migrated schema for the rollback window.

### 7.3 Candidate phase

After migration succeeds, start the requested runtime image as a temporary candidate container bound only to a loopback candidate port, default `127.0.0.1:3101 -> 3000`.

Candidate rules:

- fixed non-public loopback binding;
- same production env file as the real application;
- distinct container name from `dasigap`;
- remove stale candidate before starting a new one;
- wait for `/api/health/live` and `/api/health/ready`;
- require both responses to report the exact requested release SHA;
- remove candidate on success or failure.

If candidate validation fails, the production `dasigap` container is untouched.

## 8. Production switch and automatic restoration

Only a validated candidate may proceed to production replacement.

The switch sequence is:

1. capture the current production immutable image as `previous-image`;
2. recreate `dasigap` on the existing loopback production binding `127.0.0.1:3000` using the requested immutable runtime image;
3. verify local `/api/health/live` and `/api/health/ready` and require the exact requested SHA;
4. return success to the deploy workflow only after local verification passes.

If local post-switch verification fails:

- recreate the prior immutable application image immediately when one exists;
- verify the restored application's liveness/readiness locally;
- mark deployment failed;
- never downgrade the database.

For the first deployment, when no previous immutable image exists, a failed new container is stopped/removed and deployment fails without inventing a rollback target.

## 9. External HTTPS verification

The protected production deploy workflow performs a final public HTTPS readiness check after the server-local switch succeeds.

The public base URL is supplied through the GitHub `production` environment configuration, not hardcoded in source.

The workflow requires:

- HTTPS only;
- `/api/health/ready` returns HTTP 200;
- body status is `ready`;
- body release exactly equals the requested SHA.

If external verification fails, the workflow calls the server rollback path using the recorded previous application image, verifies the restored public endpoint where possible, and fails the workflow.

## 10. Manual rollback

A separate protected manual rollback workflow accepts a full immutable application SHA.

Rollback rules:

- shared concurrency group with production deploy so deploy and rollback cannot overlap;
- `environment: production`;
- pinned SSH trust;
- no migration image execution;
- no `prisma migrate deploy`;
- no source checkout/build on the server;
- pull only `ghcr.io/bloombouquet/dasigap:sha-<target>`;
- validate the target as a loopback candidate first;
- only then replace production;
- local and external health must report the exact target SHA;
- if the rollback target fails after production replacement, restore the application image that was current when rollback started.

The database remains at its forward-migrated schema version.

## 11. Container and network constraints

- Production application remains bound only to `127.0.0.1:3000`.
- Candidate remains bound only to loopback, default port `3101`.
- No application container publishes directly on `0.0.0.0`.
- The HTTPS reverse proxy remains the only public ingress path.
- Candidate cleanup runs on both normal completion and failure.

## 12. Security requirements

- Never use `ssh-keyscan` in the production workflow.
- Never use `StrictHostKeyChecking=no`.
- Never package or print the server env file.
- Never echo GHCR tokens, SSH keys, DB credentials, object-storage credentials, or OAuth credentials.
- Production deployment uses only immutable SHA tags, never `latest`.
- Health endpoints expose no dependency error details or secret configuration.
- User-controlled SHA and URL values are validated before shell use.
- The public production base URL must be HTTPS and contain no embedded username/password.

## 13. Failure semantics

| Failure | Required behavior |
| --- | --- |
| Invalid/unreachable SHA | Fail before SSH deployment |
| Image pull failure | Current application unchanged |
| Migration failure | Current application unchanged |
| Candidate live failure | Current application unchanged |
| Candidate ready failure | Current application unchanged |
| Candidate wrong SHA | Current application unchanged |
| Production local health failure | Restore previous application image |
| Public HTTPS readiness failure | Restore previous application image |
| Manual rollback candidate failure | Current application unchanged |
| Manual rollback post-switch failure | Restore application that was current before rollback |

No failure path automatically reverses a database migration.

## 14. Testing strategy

Implementation follows TDD.

### Application tests

- release SHA parsing and fallback behavior;
- liveness status/body/cache headers;
- readiness 200/503 behavior;
- readiness never leaks individual dependency failure details;
- timeout and thrown/rejected dependency behavior.

### Storage integration

Against the existing CI MinIO service:

- authenticated bucket `HEAD` succeeds;
- failed credentials/config fail readiness;
- readiness does not create an object.

### Deployment script tests

Use temporary state and stubbed Docker/curl commands to prove:

- invalid SHA is rejected;
- candidate failure leaves current production untouched;
- migration failure leaves current production untouched;
- successful candidate allows switch;
- wrong release SHA is rejected even when HTTP is 200;
- local post-switch failure restores previous image;
- rollback never invokes migration;
- rollback candidate failure leaves current untouched;
- rollback post-switch failure restores the original application.

### Workflow static tests

Assert:

- production environment protection;
- one shared deploy/rollback concurrency group;
- pinned known-hosts usage;
- no `ssh-keyscan`;
- no `StrictHostKeyChecking=no`;
- no server-side `git pull`;
- immutable SHA image names;
- production image build receives `RELEASE_SHA`;
- deploy validates `main` ancestry;
- rollback contains no migration command.

### Existing regression gates

The normal CI remains required:

- frozen install;
- Prisma validate/migrations against CI PostgreSQL;
- typecheck;
- full unit/integration/security tests;
- MinIO integration;
- production build;
- Playwright release suite;
- production image smoke tests.

## 15. Documentation

Update the existing `docs/DEPLOYMENT.md` rather than creating a competing operations guide.

The document must distinguish:

- repository automation readiness;
- actual production infrastructure prerequisites;
- initial deployment behavior;
- normal deployment behavior;
- candidate validation;
- automatic application restoration;
- manual rollback;
- the fact that DB migrations are not downgraded.

Do not claim that a real production deployment or BloomBouquet OAuth rollout has occurred unless those external steps have actually been completed.

## 16. Implementation boundary

Expected implementation areas:

- `Dockerfile`;
- `.github/workflows/production-image.yml`;
- `.github/workflows/deploy-production.yml`;
- a protected rollback workflow;
- `deploy/deploy.sh`;
- `deploy/rollback.sh`;
- `deploy/compose.production.yml` only where needed for health/candidate support;
- health/readiness modules and routes;
- object-storage readiness signing/probe support;
- CI tests for application, MinIO, deployment scripts, and workflows;
- `docs/DEPLOYMENT.md`.

The implementation must not copy PM2/tar release machinery from `dasigap/devops-production-release`.