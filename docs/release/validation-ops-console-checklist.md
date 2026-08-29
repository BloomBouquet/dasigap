# Validation Ops Console Release Checklist

## Verification target

- [x] Repository: `BloomBouquet/dasigap`
- [x] Branch: `dasigap/validation-ops`
- [x] Base branch: `main`
- [x] Verified implementation SHA: `8cd24da513ae56847f54ccdb03d672200ccd823b`
- [x] Verified base SHA: `bc448ac5311a9d602c494c79b5cda7581e258120`
- [x] Branch comparison at release gate: ahead 16, behind 0
- [x] CI run: `33237630039` (`CI #424`) — success
- [x] Production Image run: `33237630051` (`Production Image #26`) — success

## Access boundary

- [x] `/api/internal/validation` requires an authenticated Bouquet user.
- [x] `VALIDATION_ADMIN_USER_IDS` is the authoritative comma-separated server-side allowlist.
- [x] Allowlist entries are trimmed and compared by exact opaque user ID.
- [x] Missing or empty allowlist fails closed with `503 VALIDATION_ADMIN_NOT_CONFIGURED` after authentication.
- [x] Authenticated non-admin users receive `403 FORBIDDEN`.
- [x] Unauthenticated requests receive `401 UNAUTHORIZED`.
- [x] Authorization and success responses use `Cache-Control: private, no-store`.
- [x] Production env template documents `VALIDATION_ADMIN_USER_IDS=`.

## Privacy and read-only behavior

- [x] Internal validation API returns aggregate metrics only.
- [x] Response DTO does not expose raw `userId`, raw `itemId`, event IDs, raw ProductEvent arrays, individual event timestamps, or freeform metadata.
- [x] Product names, stores, receipt/document contents, defect notes, generated resale copy, advertising IDs, and device fingerprints are not exposed.
- [x] GET `/api/internal/validation` does not create or mutate ProductEvent rows.
- [x] `/internal/*` is isolated from `AppVisitTracker`, so opening the ops console does not create `APP_VISITED`.
- [x] `/internal/*` does not render the consumer `BottomNav`.
- [x] Existing external analytics SDK and forbidden-feature guards remain enabled.

## Retention definition

- [x] Retention cohort starts on each user's first `ITEM_REGISTRATION_COMPLETED` KST calendar date.
- [x] D7 retained window is cohort day +6 through +8.
- [x] D7 denominator includes only users whose observation date is at least cohort day +8.
- [x] D30 retained window is cohort day +27 through +33.
- [x] D30 denominator includes only users whose observation date is at least cohort day +33.
- [x] Empty denominators produce rate `0`, never `NaN`.
- [x] Raw ProductEvent retention remains 180 days.

## CI evidence

From CI run `33237630039` on SHA `8cd24da513ae56847f54ccdb03d672200ccd823b`:

- [x] Dependency install with frozen lockfile passed.
- [x] Prisma client generation passed.
- [x] Prisma schema validation passed.
- [x] All 9 Prisma migrations applied successfully.
- [x] TypeScript `tsc --noEmit` passed.
- [x] Vitest: 28 test files passed, 1 skipped.
- [x] Vitest: 122 tests passed, 1 skipped.
- [x] Validation admin unit tests: 3/3 passed.
- [x] Internal validation integration tests: 4/4 passed.
- [x] Validation retention metric tests: 6/6 passed.
- [x] Server deployment artifact tests: 7/7 passed.
- [x] Real MinIO S3 signed-URL integration: 1/1 passed.
- [x] Next.js production build passed and included `/api/internal/validation` and `/internal/validation` routes.
- [x] Playwright release suite: 14/14 passed.

## Production image evidence

From Production Image run `33237630051` on SHA `8cd24da513ae56847f54ccdb03d672200ccd823b`:

- [x] Production Docker image build passed.
- [x] Production image health smoke test passed.
- [x] Prisma migrator image build passed.
- [x] Migrator image smoke test against PostgreSQL 17 passed.

## Review result

- [x] Luna Code Review: no remaining Critical or Important findings after fixes.
- [x] Luna Security Review: allowlist is server-only and fail-closed; raw analytics data is not exposed by the route.
- [x] Review finding about missing production `VALIDATION_ADMIN_USER_IDS` configuration was covered by a RED deployment-artifact test and fixed before this release gate.
- [x] Latest `main` production deployment changes were merged into the feature branch before the final verification run.

## Merge gate

- [x] Implementation evidence is green on the latest base combination.
- [x] Production image and migration image smoke tests are green.
- [x] No schema migration is introduced by Validation Ops Console itself.
- [x] PR must still run its merge-ref CI successfully before merge.
