# 제품 검증 계측 Release Checklist

- Project: 다시값 (Dasigap)
- Scope: 1st-party product validation analytics
- Verified code SHA: `8eee03392c1b99b69d3ebc722b637d65375263bc`
- GitHub Actions run: `33222406967` / CI #327
- Verified at: 2026-08-29
- Result: PASS

## Database / Migration

- [x] Prisma client generation succeeds.
- [x] `prisma validate` succeeds.
- [x] All 8 migrations deploy from an empty PostgreSQL database.
- [x] `ProductEvent.dedupeKey` has a unique constraint for server visit idempotency.
- [x] `ProductEvent.createdAt` has a retention-query index.
- [x] Item-scoped `ProductEvent.itemId` is a foreign key to `Item.id` with `ON DELETE CASCADE`.

Applied migrations:

1. `20260827144000_init`
2. `20260828063000_add_return_deadline`
3. `20260828081000_add_resale_photo_checklist`
4. `20260828225000_add_product_events`
5. `20260829020000_add_product_event_dedupe`
6. `20260829084500_add_validation_event_types`
7. `20260829085000_index_product_event_created_at`
8. `20260829090000_link_product_events_to_items`

## Type / Test Verification

- [x] TypeScript `tsc --noEmit` passes.
- [x] Vitest: **23 test files passed, 1 skipped**.
- [x] Vitest: **99 tests passed, 1 skipped**.
- [x] Real S3-compatible MinIO signed-URL integration: **1 test passed**.
- [x] Production `next build` succeeds.
- [x] Playwright release suite: **9 / 9 passed**.

## Analytics Trust Boundaries

- [x] Client event API accepts only the fixed client event allowlist.
- [x] Client-supplied `userId` is rejected; authenticated server identity is authoritative.
- [x] Item-scoped client events verify ownership before storage.
- [x] `ITEM_REGISTRATION_COMPLETED`, `ITEM_LIFECYCLE_UPDATED`, `SALE_COMPLETED`, and `USAGE_COST_VIEWED` are server-only and cannot be forged through the client event API.
- [x] Registration duration is derived from a same-user server-created start event and server timestamps.
- [x] Invalid, foreign, missing, or older-than-30-minute registration start events produce `durationMs = null` rather than trusting client timing.
- [x] `APP_VISITED` is deduplicated by a server-generated KST daily key and Prisma upsert.
- [x] Client localStorage/device date is not an analytics correctness boundary.

## Domain Event Integrity

- [x] Lifecycle update events are emitted only after successful lifecycle/component/maintenance mutations.
- [x] Cross-user lifecycle failures do not emit analytics.
- [x] Resale events send only fixed event type + item ID; generated sale text and defect notes are not sent.
- [x] `RESALE_COPY_COPIED` is emitted only after clipboard copy succeeds.
- [x] `SALE_COMPLETED` is committed atomically with `SaleRecord` creation and Item `SOLD` status.
- [x] Retention cleanup failure does not block a legitimate sale completion.
- [x] Usage-cost report views are recorded only after a successful owner-scoped report read.

## Retention / Deletion

- [x] Raw `ProductEvent` retention policy is 180 days.
- [x] Events older than the cutoff are pruned before normal server event writes.
- [x] Retention cleanup has a dedicated `createdAt` index.
- [x] Item-scoped analytics are immediately cascade-deleted when the owning Item is deleted.

## Metrics

- [x] First-item registration conversion is calculated from the same started-user cohort.
- [x] Registration duration reports median milliseconds and handles no-sample state.
- [x] D7 / D30 retention uses KST calendar dates inside the retained 180-day observation window.
- [x] Resale completion, copy usage, and sale completion numerators are intersected with their denominator cohorts.
- [x] Lifecycle usage and usage-cost views expose event and unique-user/item counts.
- [x] Empty denominators return `0`, never `NaN`.

## Privacy / Security

- [x] No arbitrary/freeform analytics payload is stored.
- [x] Analytics does not store product name, brand, model, store, receipt/document raw content, defect note, generated resale copy, advertising identifier, or device fingerprint.
- [x] No external product analytics SDK/package is installed.
- [x] CI regression tests reject known external analytics SDKs/tags.
- [x] Existing marketplace automation/scraping/credential/payment restrictions remain enforced.
- [x] Analytics event API responses use `Cache-Control: no-store`.
- [x] 개인정보처리방침 documents the analytics purpose, minimum fields, excluded data, and 180-day raw-event retention policy.

## Release Decision

The product-validation analytics implementation at code SHA `8eee03392c1b99b69d3ebc722b637d65375263bc` satisfies the defined release gates based on CI run `33222406967`.

The commit adding this checklist is documentation-only and must itself pass the repository's full CI before PR #14 can be marked ready and merged.

### Non-blocking follow-up warnings

- Next.js reports that the `middleware` file convention is deprecated in favor of `proxy`.
- Vitest/Vite reports a future config-loader compatibility warning for ESM syntax in the current CommonJS-loaded config.

These warnings did not fail typecheck, build, unit/integration/security tests, S3 integration, or the Playwright release suite and are outside the analytics merge scope.
