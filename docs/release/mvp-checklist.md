# 다시값 MVP Release Checklist

## MVP feature acceptance baseline

The approved V1 product scope remains unchanged:

- purchase record → return/warranty → ownership/repair → resale preparation → external marketplace handoff → actual sale record → effective usage cost
- no internal marketplace, buyer/seller matching, chat, payment, or escrow
- no marketplace scraping, unofficial login/post automation, or marketplace credential storage
- receipts and supporting documents remain private
- warranty UI remains an estimate based on registered information

The existing unit, integration, security, MinIO, build, and Playwright suites remain the feature acceptance gate.

## Production release automation

| Gate | Status | Evidence |
| --- | --- | --- |
| Liveness endpoint exposes only status + exact release SHA | PASS | `/api/health/live`; integration coverage |
| Readiness checks PostgreSQL and object storage without creating objects | PASS | `/api/health/ready`; readiness unit/integration + real MinIO HEAD coverage |
| Immutable SHA-based release artifact | PASS | `ops/release/create-artifact.mjs` + allowlist test |
| Release artifact excludes environment files | PASS | artifact allowlist test + build workflow archive inspection |
| Build workflow always packages current `main` SHA | PASS | `.github/workflows/build-production-release.yml` checks out `main` and resolves `git rev-parse HEAD` |
| Deploy accepts only a successful trusted build-workflow run | PASS | run event/conclusion/path/SHA provenance validation in deploy workflow |
| Downloaded artifact SHA must match source workflow SHA | PASS | `ops/release/validate-artifact.mjs` + deploy workflow |
| SSH host trust is pinned | PASS | `PRODUCTION_KNOWN_HOSTS`; no `ssh-keyscan` or disabled host checking |
| Candidate is validated before `current` mutation | PASS | `validate-candidate.sh` + release operation tests |
| Production switch is atomic and exact-SHA health checked | PASS | `switch-release.sh` + release operation tests |
| Post-switch failure restores the prior release | PASS | release operation tests |
| Manual rollback uses an already installed SHA only | PASS | `rollback-release.sh` + protected rollback workflow |
| Rollback performs no install or database migration | PASS | rollback script/workflow static boundary tests |
| Release retention protects current, previous, and three newest extras | PASS | `cleanup-releases.sh` deterministic retention test |
| Release shell syntax is a CI gate | PASS | `pnpm check:ops` in `.github/workflows/ci.yml` |

## Production host contract

The server layout is fixed to:

```text
/home/ubuntu/dasigap/
├── current -> releases/<sha>
├── previous -> releases/<sha>
├── releases/<sha>/
├── shared/.env.production
└── .staging/<sha>-<deploy-run-id>/
```

`shared/.env.production` is host-owned and must never be included in a release artifact. At minimum it must provide the production database, object storage, and Bouquet SSO configuration represented by `.env.example`.

The PM2 runtime reads the installed release metadata, injects that exact SHA as `DASIGAP_RELEASE_SHA`, binds Next.js to loopback, and uses the configured production port. Reverse proxy / TLS termination remains outside the application repository.

## GitHub production environment requirements

Configure a protected GitHub Actions environment named `production` with these secrets before the first deployment:

- `PRODUCTION_HOST`
- `PRODUCTION_USER`
- `PRODUCTION_SSH_KEY`
- `PRODUCTION_KNOWN_HOSTS`
- `PRODUCTION_BASE_URL` — exact public HTTPS origin
- `PRODUCTION_SSH_PORT` — optional; defaults to `22`

Recommended repository/environment protection: require an explicit reviewer for the `production` environment so deploy and rollback remain manual release operations.

## Bouquet production SSO prerequisites

Production rollout remains blocked until all of the following are true:

1. Dasigap has a registered Bouquet OAuth client ID.
2. The exact public HTTPS callback URI is allowlisted by Bouquet.
3. Host `shared/.env.production` contains `AUTH_MODE=bouquet`, `BOUQUET_AUTH_BASE_URL`, `BOUQUET_AUTH_CLIENT_ID`, `BOUQUET_AUTH_REDIRECT_URI`, and the intended session TTL.
4. The production database and object storage credentials are installed on the host.
5. A real browser smoke test completes authorize → callback → project session → protected API → logout.

Do not substitute the older generic `/authorize`, `/token`, `/userinfo`, `BOUQUET_AUTH_APP_ID`, or `/api/auth/...` contract. The current application uses the provider-specific Bouquet routes already implemented on `main`.

## Release procedure after merge

1. Prepare `/home/ubuntu/dasigap/shared/.env.production` and the protected GitHub `production` environment.
2. Run **Build production release** manually. The workflow packages the current `main` commit into `dasigap-production-<sha>` only after migrations, tests, real MinIO integration, build, and Playwright all pass.
3. Copy that successful workflow run ID into **Deploy production release**.
4. Deploy validates run provenance, downloads the exact artifact, validates the artifact SHA, uploads to a unique staging directory, installs dependencies with the frozen lockfile, generates Prisma, applies migrations, and only then installs the immutable release directory.
5. The candidate release starts on loopback and must pass exact-SHA live/readiness checks before the `current` symlink changes.
6. After the atomic switch, PM2 reload plus local and external exact-SHA readiness checks must pass. Failure restores the prior `current` release when one exists.
7. Complete the real Bouquet browser smoke test before declaring the rollout complete.

## Manual rollback

Use **Rollback production release** with a full lowercase commit SHA that is already present under `/home/ubuntu/dasigap/releases/<sha>`.

Rollback intentionally does not download an artifact, install packages, generate Prisma, or run migrations. The target must pass candidate validation before mutation, and post-switch failure restores the release that was current before the rollback attempt.

## Required verification commands

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm prisma validate
pnpm prisma migrate deploy
pnpm typecheck
pnpm test
pnpm check:ops
pnpm build
pnpm test:e2e
```

CI additionally runs the real S3-compatible MinIO integration before build and E2E.

## Current release decision

**CODE READY / PRODUCTION ROLLOUT BLOCKED.**

The repository has the production health, immutable artifact, deploy, atomic switch, rollback, and retention boundaries required for release. Actual production deployment must not be marked complete until the protected production secrets, host environment, exact HTTPS origin, Bouquet OAuth client/callback registration, and real browser smoke test are completed.
