# Product Validation Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 다시값 MVP의 핵심 사용자 퍼널을 개인정보 최소화 원칙으로 1st-party 계측한다.

**Architecture:** PostgreSQL에 고정 enum 기반 `ProductEvent`를 저장하고, 서버 신뢰 이벤트는 도메인 성공 경로에 직접 기록하며 클라이언트 상호작용 이벤트는 인증된 `/api/product-events`로 보낸다. 자유형 metadata는 금지하고 userId는 항상 서버 인증에서 결정하며 item 관련 이벤트는 소유권을 확인한다.

**Tech Stack:** Next.js 16 + TypeScript strict + PostgreSQL + Prisma + Zod + Vitest + Playwright + pnpm

**Spec:** `docs/superpowers/specs/2026-08-28-product-validation-analytics-design.md`

## Global Constraints

- 외부 분석 SDK를 추가하지 않는다.
- 이벤트 타입은 `APP_VISITED`, `ITEM_REGISTRATION_STARTED`, `ITEM_REGISTRATION_COMPLETED`, `RESALE_STARTED`, `RESALE_COMPLETED`, `RESALE_COPY_COPIED`, `SALE_COMPLETED`만 허용한다.
- 자유형 JSON metadata를 저장하지 않는다.
- 제품명, 구매처, 영수증/문서 키, 하자 메모, 생성 판매글 내용을 이벤트에 저장하지 않는다.
- 클라이언트 요청에서 userId를 받지 않는다.
- item 관련 이벤트는 현재 인증 사용자의 소유권을 검증한다.
- 등록 duration 허용 범위는 `0..3,600,000ms`다.
- 계측 실패가 핵심 제품 작업을 막지 않도록 client-side 이벤트는 best-effort로 처리한다.
- `SALE_COMPLETED`는 판매 완료 트랜잭션과 원자적으로 저장한다.

---

## File Structure

- `prisma/schema.prisma`: `ProductEventType`, `ProductEvent` 모델 정의
- `prisma/migrations/20260828225000_add_product_events/migration.sql`: 이벤트 테이블/enum/index migration
- `src/analytics/events.ts`: 허용 이벤트 schema, duration parser, record 함수
- `src/analytics/events.test.ts`: 순수 validation/duration 단위 테스트
- `app/api/product-events/route.ts`: 인증된 client event ingest API
- `tests/integration/product-events.test.ts`: 인증/소유권/저장 필드 통합 테스트
- `components/analytics/app-visit-tracker.tsx`: 일 단위 방문 이벤트 best-effort 전송
- `components/app-shell.tsx`: 방문 tracker 연결
- `components/form/item-form.tsx`: 등록 시작 이벤트와 duration header 연결
- `app/api/items/route.ts`: 등록 완료 이벤트 기록
- `components/resale/resale-stepper.tsx`: 판매 준비 시작/완료 이벤트 연결
- `components/resale/generated-copy.tsx`: clipboard 성공 후 복사 이벤트 연결
- `src/reports/sale-service.ts`: 판매 완료 트랜잭션 이벤트 기록
- `tests/integration/item-api.test.ts`: 등록 완료 이벤트 검증 추가
- `tests/integration/sale-report.test.ts`: 판매 완료 이벤트 검증 추가
- `tests/e2e/resale-flow.spec.ts`: 판매 준비/복사 회귀 검증

---

### Task 1: Product Event Domain and Persistence

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260828225000_add_product_events/migration.sql`
- Create: `src/analytics/events.ts`
- Create: `src/analytics/events.test.ts`

**Interfaces:**
- Produces: `clientProductEventSchema`, `parseRegistrationDuration(value: string | null): number | null`, `recordProductEvent(input)`

- [ ] **Step 1: Write failing duration/schema tests**

Test that allowed client event names parse, unknown names fail, extra keys fail, and registration duration accepts integer `0..3600000` while rejecting negative, float, text, and larger values.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/analytics/events.test.ts`
Expected: FAIL because `src/analytics/events.ts` does not exist.

- [ ] **Step 3: Add Prisma enum/model and migration**

Schema:

```prisma
enum ProductEventType {
  APP_VISITED
  ITEM_REGISTRATION_STARTED
  ITEM_REGISTRATION_COMPLETED
  RESALE_STARTED
  RESALE_COMPLETED
  RESALE_COPY_COPIED
  SALE_COMPLETED
}

model ProductEvent {
  id         String           @id @default(uuid()) @db.Uuid
  userId     String
  itemId     String?          @db.Uuid
  type       ProductEventType
  durationMs Int?
  createdAt  DateTime         @default(now())

  @@index([userId, createdAt])
  @@index([type, createdAt])
  @@index([itemId, type])
}
```

Migration creates PostgreSQL enum, table, and indexes. Do not add JSON columns.

- [ ] **Step 4: Implement minimal analytics domain**

`clientProductEventSchema` is `.strict()` and permits only the five client event types. `itemId` is required for resale events and forbidden for app visit / registration-start. `recordProductEvent` accepts only typed fields and calls `prisma.productEvent.create`.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
pnpm db:generate
pnpm vitest run src/analytics/events.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma src/analytics
git commit -m "feat: add privacy-minimal product event model"
```

---

### Task 2: Authenticated Client Event API

**Files:**
- Create: `app/api/product-events/route.ts`
- Create: `tests/integration/product-events.test.ts`

**Interfaces:**
- Consumes: `clientProductEventSchema`, `recordProductEvent`, `requireUser`, `getOwnedItem`
- Produces: `POST /api/product-events -> 202`

- [ ] **Step 1: Write failing integration tests**

Cover:

1. no auth -> 401
2. body containing `userId` -> 400 due strict schema
3. `APP_VISITED` with no item -> 202 and DB event userId equals authenticated user
4. resale event for owned item -> 202
5. resale event for another user's item -> 404 and no event row
6. arbitrary `metadata`, `text`, or `receipt` fields -> 400

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run tests/integration/product-events.test.ts`
Expected: FAIL because route does not exist.

- [ ] **Step 3: Implement route**

Flow:

```text
requireUser -> readJsonBody -> clientProductEventSchema.parse
-> if itemId then getOwnedItem(user.userId, itemId)
-> recordProductEvent({ userId: user.userId, itemId, type })
-> 202 { accepted: true }
```

Response header includes `Cache-Control: no-store`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm vitest run tests/integration/product-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/product-events tests/integration/product-events.test.ts
git commit -m "feat: add authenticated product event ingestion"
```

---

### Task 3: Registration Funnel and Visit Tracking

**Files:**
- Create: `components/analytics/app-visit-tracker.tsx`
- Modify: `components/app-shell.tsx`
- Modify: `components/form/item-form.tsx`
- Modify: `app/api/items/route.ts`
- Modify: `tests/integration/item-api.test.ts`

**Interfaces:**
- Consumes: `/api/product-events`, `parseRegistrationDuration`, `recordProductEvent`
- Produces: `APP_VISITED`, `ITEM_REGISTRATION_STARTED`, `ITEM_REGISTRATION_COMPLETED`

- [ ] **Step 1: Add failing item API assertion**

After successful POST `/api/items` with header `x-dasigap-registration-duration-ms: 84500`, assert exactly one `ITEM_REGISTRATION_COMPLETED` row exists for authenticated user, created item id, and `durationMs=84500`.

Also assert invalid header `99999999` still creates item but event has `durationMs=null`.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run tests/integration/item-api.test.ts`
Expected: FAIL because completion event is not recorded.

- [ ] **Step 3: Record registration completion server-side**

After `createItem` succeeds, parse duration header and record `ITEM_REGISTRATION_COMPLETED`. If analytics insertion fails, log server error and still return the created item; do not fail core item registration.

- [ ] **Step 4: Connect client registration start/duration**

`ItemForm` stores `performance.now()` on mount, sends a best-effort `ITEM_REGISTRATION_STARTED` event once, and includes integer elapsed milliseconds in `x-dasigap-registration-duration-ms` on item POST.

No form field values are sent to the event API.

- [ ] **Step 5: Add app visit tracker**

`AppVisitTracker` sends `APP_VISITED` once per local calendar day when possible. localStorage failure or network failure is swallowed. Mount it from `AppShell`.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
pnpm vitest run tests/integration/item-api.test.ts src/analytics/events.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app components tests/integration/item-api.test.ts
git commit -m "feat: track visit and item registration funnel"
```

---

### Task 4: Resale Funnel Tracking

**Files:**
- Modify: `components/resale/resale-stepper.tsx`
- Modify: `components/resale/generated-copy.tsx`
- Modify: `tests/e2e/resale-flow.spec.ts`

**Interfaces:**
- Produces: `RESALE_STARTED`, `RESALE_COMPLETED`, `RESALE_COPY_COPIED`

- [ ] **Step 1: Add failing E2E assertions**

During normal resale flow, observe `/api/product-events` calls and assert event types include start and completed. Stub clipboard successfully, click `판매글 복사`, and assert `RESALE_COPY_COPIED` is sent only after clipboard resolves.

- [ ] **Step 2: Verify RED**

Run: `pnpm test:e2e -- tests/e2e/resale-flow.spec.ts`
Expected: FAIL because events are not emitted.

- [ ] **Step 3: Implement best-effort client helper calls**

In `ResaleStepper`, after initial draft/components load success send `RESALE_STARTED` with itemId. After Step 5 save moves to Step 6 send `RESALE_COMPLETED`.

Change `GeneratedCopy` props to include `itemId`; after successful `navigator.clipboard.writeText` send `RESALE_COPY_COPIED`.

Event failures must not change the existing success/error UI.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm typecheck
pnpm test:e2e -- tests/e2e/resale-flow.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/resale tests/e2e/resale-flow.spec.ts
git commit -m "feat: track resale preparation funnel"
```

---

### Task 5: Atomic Sale Completion Event

**Files:**
- Modify: `src/reports/sale-service.ts`
- Modify: `tests/integration/sale-report.test.ts`

**Interfaces:**
- Produces: `SALE_COMPLETED` in the same Prisma transaction as `SaleRecord` + Item status `SOLD`

- [ ] **Step 1: Add failing integration assertion**

After successful `recordOwnedItemSale`, assert one `SALE_COMPLETED` event exists with the same `userId` and `itemId`.

Assert duplicate sale does not create a second event.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run tests/integration/sale-report.test.ts`
Expected: FAIL because sale event is absent.

- [ ] **Step 3: Implement transaction event**

Inside the existing transaction, after ownership-preserving item update succeeds, insert:

```ts
await tx.productEvent.create({
  data: { userId, itemId, type: "SALE_COMPLETED" },
});
```

Return sale only after all writes succeed.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm vitest run tests/integration/sale-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reports/sale-service.ts tests/integration/sale-report.test.ts
git commit -m "feat: track atomic sale completion"
```

---

### Task 6: Security and Release Gate

**Files:**
- Modify only if verification exposes a defect.

- [ ] **Step 1: Run forbidden data scan**

Confirm `ProductEvent` has no JSON/string payload fields beyond ids/type and no analytics request accepts `userId`.

- [ ] **Step 2: Run database and test suite**

```bash
pnpm db:generate
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Expected: all PASS.

- [ ] **Step 3: Security review**

Verify unauthenticated event writes are 401, cross-user item events are indistinguishable 404, response is no-store, and event failure never exposes sensitive values.

- [ ] **Step 4: Code review**

Verify event naming is fixed, duplicate tracking is acceptable for aggregate metrics, no marketplace scope is introduced, and existing MVP flows remain unchanged.

- [ ] **Step 5: Commit fixes if required**

Use English commit messages scoped to actual fixes.

- [ ] **Step 6: Open PR**

Use the repository's required Korean PR title/body format and target `main`.

---

## Self-review

- Spec coverage: all event types and privacy rules map to Tasks 1-5; release/security gates map to Task 6.
- Placeholder scan: no TBD/TODO/unspecified implementation steps remain.
- Type consistency: `ProductEventType`, `itemId`, `durationMs`, and `/api/product-events` are consistent across tasks.
- Scope: admin analytics dashboard and external SDKs intentionally remain out of scope.
