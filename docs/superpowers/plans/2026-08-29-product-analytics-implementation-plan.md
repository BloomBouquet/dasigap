# Product Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 다시값 MVP의 첫 물건 등록, 재방문, 생애관리, 판매 준비, 판매 완료, 사용비 리포트 소비를 개인정보를 최소화한 1st-party 이벤트로 측정한다.

**Architecture:** PostgreSQL에 allowlist 기반 `ProductEvent`를 저장하고, 서버가 확실히 아는 성공 이벤트는 기존 API 성공 이후 best-effort로 기록한다. 브라우저에서만 알 수 있는 행동은 단일 `POST /api/analytics/events` 엔드포인트로 제한하며, 자유형 JSON properties와 도메인 텍스트는 저장하지 않는다. 퍼널 계산은 외부 analytics SDK 없이 `src/analytics` 내부의 repository + 순수 계산 함수로 구현한다.

**Tech Stack:** Next.js 16 + TypeScript strict + PostgreSQL + Prisma 6 + Zod 4 + Vitest + Playwright + pnpm

**Spec:** `docs/superpowers/specs/2026-08-29-product-analytics-design.md`

## Global Constraints

- 외부 analytics SDK를 도입하지 않는다.
- 자동 클릭 추적, 세션 리플레이, device fingerprint, 광고 식별자를 수집하지 않는다.
- 이벤트는 allowlist 타입과 고정 필드만 저장하며 자유형 `properties: JSON`을 만들지 않는다.
- 제품명, 브랜드, 모델명, 구매처, 구성품명, 수리/하자 메모, 영수증/OCR 내용, 판매글 원문을 이벤트에 저장하지 않는다.
- 클라이언트는 `userId`와 `occurredAt`을 지정할 수 없다.
- 특정 item 이벤트는 항상 현재 인증 사용자의 item 소유권을 검증한다.
- 핵심 도메인 작업이 성공한 뒤 analytics 저장이 실패해도 사용자 작업은 성공으로 유지한다.
- KST calendar date 기준 `APP_VISITED`는 사용자당 하루 최대 1건이다.
- 등록 소요시간은 클라이언트 timestamp가 아니라 서버에 저장된 `ITEM_REGISTRATION_STARTED`의 `occurredAt`과 완료 시점 서버 시간을 사용한다.
- 등록 소요시간은 0초 초과, 최대 30분까지만 유효하며 범위를 벗어나면 `durationMs = null`로 기록한다.
- `RESALE_STARTED`, `RESALE_COMPLETED`, `SALE_COMPLETED` 같은 핵심 one-time 이벤트는 item 단위 중복을 막는다.
- raw ProductEvent 보존 기준은 180일이다.
- V1에서 public analytics 조회 API나 사용자용 analytics dashboard를 만들지 않는다.

---

# File Structure

```text
src/analytics/
├─ types.ts                 # 이벤트 타입/내부 입력 타입
├─ schemas.ts               # 클라이언트 이벤트 strict allowlist
├─ time.ts                  # KST 날짜 키와 duration 검증
├─ repository.ts            # ProductEvent write/read/idempotency
├─ safe-record.ts           # 도메인 작업을 깨뜨리지 않는 best-effort wrapper
├─ funnels.ts               # 순수 퍼널 계산
└─ funnels.test.ts          # 퍼널/retention 계산 단위 테스트

app/api/analytics/events/route.ts
                              # 클라이언트에서 허용한 이벤트만 수집
components/analytics/app-visit-tracker.tsx
                              # 앱 실제 브라우저 방문 측정

prisma/schema.prisma
prisma/migrations/20260829010000_product_analytics/migration.sql

scripts/purge-product-events.mjs
                              # 180일 초과 raw event 운영 정리 절차

tests/integration/product-analytics.test.ts
                              # schema, ownership, idempotency, duration, hooks

tests/e2e/product-analytics.spec.ts
                              # 등록/복사/리포트 UI 행동 회귀
```

기존 파일 수정:

```text
components/form/item-form.tsx
components/app-shell.tsx
components/resale/generated-copy.tsx
app/(app)/report/page.tsx
app/api/items/route.ts
app/api/items/[id]/lifecycle/route.ts
app/api/items/[id]/components/route.ts
app/api/items/[id]/maintenance/route.ts
app/api/items/[id]/resale/route.ts
app/api/items/[id]/sale/route.ts
app/privacy/page.tsx
package.json
```

---

### Task 1: ProductEvent persistence, allowlist types, and safe recording

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260829010000_product_analytics/migration.sql`
- Create: `src/analytics/types.ts`
- Create: `src/analytics/time.ts`
- Create: `src/analytics/repository.ts`
- Create: `src/analytics/safe-record.ts`
- Create: `tests/integration/product-analytics.test.ts`

**Interfaces:**
- Produces: `ProductEventType`
- Produces: `recordProductEvent(input): Promise<{ id: string; occurredAt: Date }>`
- Produces: `recordProductEventOnce(input & { dedupeKey: string }): Promise<void>`
- Produces: `recordProductEventSafely(input): Promise<void>`
- Produces: `resolveRegistrationDurationMs(userId, startEventId, completedAt): Promise<number | null>`
- Produces: `kstDateKey(date): string`

- [ ] **Step 1: Write failing persistence tests**

Add tests that prove:

```ts
expect(await prisma.productEvent.count()).toBe(0);

const event = await recordProductEvent({
  userId: "analytics-user-a",
  type: "ITEM_REGISTRATION_STARTED",
});

expect(event.id).toMatch(UUID_PATTERN);
expect(await prisma.productEvent.count()).toBe(1);
```

Also test `itemId`, `durationMs`, and timestamps without storing any arbitrary payload column.

- [ ] **Step 2: Run the focused integration test and verify RED**

Run:

```bash
pnpm vitest run tests/integration/product-analytics.test.ts
```

Expected: FAIL because `ProductEvent` and `src/analytics/*` do not exist.

- [ ] **Step 3: Add ProductEvent Prisma schema**

Add:

```prisma
enum ProductEventType {
  ITEM_REGISTRATION_STARTED
  ITEM_REGISTRATION_COMPLETED
  APP_VISITED
  ITEM_LIFECYCLE_UPDATED
  RESALE_STARTED
  RESALE_COMPLETED
  RESALE_COPY_COPIED
  SALE_COMPLETED
  USAGE_COST_VIEWED
}

model ProductEvent {
  id          String           @id @default(uuid()) @db.Uuid
  userId      String
  itemId      String?          @db.Uuid
  type        ProductEventType
  durationMs  Int?
  dedupeKey   String?          @unique
  occurredAt  DateTime         @default(now())
  item        Item?            @relation(fields: [itemId], references: [id], onDelete: SetNull)

  @@index([userId, occurredAt])
  @@index([type, occurredAt])
  @@index([itemId, type, occurredAt])
}
```

Add `productEvents ProductEvent[]` to `Item`.

`dedupeKey` is an internal idempotency mechanism only. It is never accepted directly from the client and is not returned as analytics data.

- [ ] **Step 4: Create migration SQL**

Create the enum, table, FK with `ON DELETE SET NULL`, indexes, and unique index on nullable `dedupeKey`.

Run:

```bash
pnpm prisma validate
pnpm prisma generate
```

Expected: both PASS.

- [ ] **Step 5: Implement analytics types and time helpers**

`src/analytics/types.ts`:

```ts
import type { ProductEventType } from "@prisma/client";

export type ProductEventInput = {
  userId: string;
  itemId?: string | null;
  type: ProductEventType;
  durationMs?: number | null;
  dedupeKey?: string | null;
};
```

`src/analytics/time.ts` must expose:

```ts
export function kstDateKey(date: Date): string;
export function validDurationMs(startedAt: Date, completedAt: Date): number | null;
```

`validDurationMs` returns null when `delta <= 0` or `delta > 1_800_000`.

- [ ] **Step 6: Implement repository and safe wrapper**

Repository rules:

```ts
recordProductEvent(input)
recordProductEventOnce({ ...input, dedupeKey })
resolveRegistrationDurationMs(userId, startEventId, completedAt)
```

`resolveRegistrationDurationMs` must query by all of:

```ts
{
  id: startEventId,
  userId,
  type: "ITEM_REGISTRATION_STARTED",
}
```

and must never accept another user's start event.

`recordProductEventOnce` should treat Prisma unique-conflict `P2002` on `dedupeKey` as a successful no-op, but rethrow other errors.

`recordProductEventSafely`:

```ts
export async function recordProductEventSafely(input: ProductEventInput) {
  try {
    await recordProductEvent(input);
  } catch (error) {
    console.error("product analytics event failed", error);
  }
}
```

Provide an equivalent safe once helper for deduplicated events.

- [ ] **Step 7: Test idempotency, cross-user duration rejection, and safe failure semantics**

Required assertions:

```ts
expect(await countByDedupeKey(key)).toBe(1);
expect(await resolveRegistrationDurationMs("user-b", userAStartId, now)).toBeNull();
expect(domainResult).toEqual(expectedSuccess); // analytics failure is swallowed by safe wrapper
```

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
pnpm vitest run tests/integration/product-analytics.test.ts
pnpm typecheck
```

Commit:

```bash
git add prisma src/analytics tests/integration/product-analytics.test.ts
git commit -m "feat: add first-party product event storage"
```

---

### Task 2: Strict client analytics endpoint and ownership boundary

**Files:**
- Create: `src/analytics/schemas.ts`
- Create: `app/api/analytics/events/route.ts`
- Modify: `tests/integration/product-analytics.test.ts`
- Modify: `tests/integration/security-boundaries.test.ts`

**Interfaces:**
- Consumes: `recordProductEvent`, `recordProductEventOnce`, `kstDateKey`
- Consumes: `requireUser`, `getOwnedItem`
- Produces: `POST /api/analytics/events`

- [ ] **Step 1: Write failing API tests**

Allowed client shapes only:

```ts
{ type: "ITEM_REGISTRATION_STARTED" }
{ type: "APP_VISITED" }
{ type: "RESALE_COPY_COPIED", itemId: UUID }
{ type: "USAGE_COST_VIEWED", itemId: UUID }
```

Reject:

```ts
{ type: "SALE_COMPLETED", itemId: UUID }
{ type: "RESALE_COPY_COPIED", itemId: UUID, generatedText: "secret" }
{ type: "APP_VISITED", userId: "spoof" }
{ type: "APP_VISITED", occurredAt: "2026-08-01" }
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run tests/integration/product-analytics.test.ts tests/integration/security-boundaries.test.ts
```

Expected: route/schema missing.

- [ ] **Step 3: Implement strict discriminated union**

Use `z.discriminatedUnion("type", [...])` with every object `.strict()`.

The API must derive `userId` from `requireUser(request)` and server time from the database/default clock.

- [ ] **Step 4: Implement event-specific behavior**

For `ITEM_REGISTRATION_STARTED`:

```ts
const event = await recordProductEvent(...);
return Response.json({ eventId: event.id }, { status: 201 });
```

For `APP_VISITED`:

```ts
dedupeKey = `visit:${userId}:${kstDateKey(now)}`;
```

For item-scoped events:

```ts
await getOwnedItem(userId, itemId);
```

then record the event. Do not return raw event rows. Return `204` for non-start events.

- [ ] **Step 5: Add ownership/privacy security tests**

Verify user B cannot submit `RESALE_COPY_COPIED` or `USAGE_COST_VIEWED` for user A's item and the response follows the existing indistinguishable ownership-not-found policy.

Verify no endpoint exists for listing raw ProductEvent rows.

- [ ] **Step 6: Run tests and commit**

```bash
pnpm vitest run tests/integration/product-analytics.test.ts tests/integration/security-boundaries.test.ts
pnpm typecheck
git add src/analytics app/api/analytics tests/integration
git commit -m "feat: add privacy-safe analytics event endpoint"
```

---

### Task 3: First-item registration funnel and trusted duration

**Files:**
- Modify: `components/form/item-form.tsx`
- Modify: `app/api/items/route.ts`
- Modify: `tests/integration/item-api.test.ts`
- Modify: `tests/integration/product-analytics.test.ts`
- Modify: `tests/e2e/first-item.spec.ts`

**Interfaces:**
- Consumes: `POST /api/analytics/events -> { eventId }` for registration start
- Consumes: `resolveRegistrationDurationMs`
- Produces: `ITEM_REGISTRATION_COMPLETED` server event with optional trusted `durationMs`

- [ ] **Step 1: Write failing registration analytics tests**

Test successful `POST /api/items` with a valid `registrationStartEventId` creates:

```ts
{
  type: "ITEM_REGISTRATION_COMPLETED",
  userId,
  itemId: createdItem.id,
  durationMs: expectedServerDelta,
}
```

Test invalid/missing/wrong-user start ID still returns `201` and records completion with `durationMs: null`.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/integration/item-api.test.ts tests/integration/product-analytics.test.ts
```

- [ ] **Step 3: Separate analytics metadata from strict Item input**

In `app/api/items/route.ts` parse the raw body once:

```ts
const { registrationStartEventId, ...itemInput } = body as Record<string, unknown>;
const item = await createItem(user.userId, itemInput as CreateItemInput);
```

Do not add `registrationStartEventId` to `createItemSchema`.

After Item creation:

```ts
const completedAt = new Date();
const durationMs = typeof registrationStartEventId === "string"
  ? await resolveRegistrationDurationMs(user.userId, registrationStartEventId, completedAt)
  : null;

await recordProductEventSafely({
  userId: user.userId,
  itemId: item.id,
  type: "ITEM_REGISTRATION_COMPLETED",
  durationMs,
});
```

Analytics lookup/record errors must not change the 201 item response.

- [ ] **Step 4: Instrument ItemForm start event without blocking the form**

On component mount, call registration-start once and store the returned ID in `useRef<string | null>`.

If start tracking fails, leave the ref null and continue normally.

On item submit add only:

```ts
registrationStartEventId: registrationStartEventId.current,
```

The user must never see an analytics-specific error.

- [ ] **Step 5: Extend first-item E2E**

Verify the visible registration flow is unchanged and item creation still succeeds when the start-event request is aborted/failed.

- [ ] **Step 6: Run and commit**

```bash
pnpm vitest run tests/integration/item-api.test.ts tests/integration/product-analytics.test.ts
pnpm test:e2e -- tests/e2e/first-item.spec.ts
pnpm typecheck
git add components/form/item-form.tsx app/api/items tests
git commit -m "feat: measure first item registration funnel"
```

---

### Task 4: Daily visit retention and lifecycle activation

**Files:**
- Create: `components/analytics/app-visit-tracker.tsx`
- Modify: `components/app-shell.tsx`
- Modify: `app/api/items/[id]/lifecycle/route.ts`
- Modify: `app/api/items/[id]/components/route.ts`
- Modify: `app/api/items/[id]/maintenance/route.ts`
- Modify: `tests/integration/item-lifecycle-api.test.ts`
- Modify: `tests/integration/product-analytics.test.ts`
- Modify: `tests/e2e/home-pwa-legal.spec.ts`

**Interfaces:**
- Produces: daily `APP_VISITED`
- Produces: successful domain mutation -> `ITEM_LIFECYCLE_UPDATED`

- [ ] **Step 1: Write failing daily-dedupe and lifecycle hook tests**

For two `APP_VISITED` posts on the same KST date:

```ts
expect(await countEvents("APP_VISITED", userId)).toBe(1);
```

For lifecycle PATCH, component POST/PATCH, maintenance POST:

```ts
expect(successResponse.status).toBeLessThan(300);
expect(await countEvents("ITEM_LIFECYCLE_UPDATED", userId, itemId)).toBe(expectedCount);
```

Failed validation/ownership operations must create zero lifecycle events.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/integration/item-lifecycle-api.test.ts tests/integration/product-analytics.test.ts
```

- [ ] **Step 3: Add AppVisitTracker**

Client component behavior:

```ts
useEffect(() => {
  if (pathname === "/privacy" || pathname === "/terms") return;
  void fetch("/api/analytics/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "APP_VISITED" }),
    keepalive: true,
  }).catch(() => undefined);
}, [pathname]);
```

Mount it once inside `AppShell`. Server dedupe guarantees route changes do not create duplicate daily rows.

- [ ] **Step 4: Hook successful lifecycle writes**

In each mutation route, resolve `id` once, perform the existing domain operation, then call:

```ts
await recordProductEventSafely({
  userId: user.userId,
  itemId: id,
  type: "ITEM_LIFECYCLE_UPDATED",
});
```

Do not move analytics inside the existing domain transaction.

- [ ] **Step 5: Run integration/E2E and commit**

```bash
pnpm vitest run tests/integration/item-lifecycle-api.test.ts tests/integration/product-analytics.test.ts
pnpm test:e2e -- tests/e2e/home-pwa-legal.spec.ts
pnpm typecheck
git add components/analytics components/app-shell.tsx app/api/items tests
git commit -m "feat: measure retention and lifecycle activation"
```

---

### Task 5: Resale, copy, sale, and usage-cost engagement funnel

**Files:**
- Modify: `app/api/items/[id]/resale/route.ts`
- Modify: `components/resale/generated-copy.tsx`
- Modify: `app/api/items/[id]/sale/route.ts`
- Modify: `app/(app)/report/page.tsx`
- Modify: `tests/integration/resale.test.ts`
- Modify: `tests/integration/sale-report.test.ts`
- Modify: `tests/integration/product-analytics.test.ts`
- Modify: `tests/e2e/resale-flow.spec.ts`
- Create: `tests/e2e/product-analytics.spec.ts`

**Interfaces:**
- Produces: item-once `RESALE_STARTED`
- Produces: item-once `RESALE_COMPLETED`
- Produces: client `RESALE_COPY_COPIED`
- Produces: item-once `SALE_COMPLETED`
- Produces: item-scoped `USAGE_COST_VIEWED`

- [ ] **Step 1: Write failing resale/sale hook tests**

Required behavior:

```ts
first successful resale PATCH -> RESALE_STARTED once
subsequent PATCH -> no second RESALE_STARTED
successful PATCH whose body has own key "askingPrice" -> RESALE_COMPLETED once
successful sale POST -> SALE_COMPLETED once
failed resale/sale -> no success event
```

Why `askingPrice` key marks completion: the existing Step 5 always sends `{ askingPrice: number | null }` immediately before Step 6. Presence of the property, not a non-null value, is the server-observable completion boundary while preserving the fact that asking price is optional.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/integration/resale.test.ts tests/integration/sale-report.test.ts tests/integration/product-analytics.test.ts
```

- [ ] **Step 3: Hook resale server events**

After `saveOwnedResaleDraft` succeeds:

```ts
await recordProductEventOnceSafely({
  userId,
  itemId: id,
  type: "RESALE_STARTED",
  dedupeKey: `item:${id}:RESALE_STARTED`,
});
```

If `Object.prototype.hasOwnProperty.call(body, "askingPrice")`:

```ts
await recordProductEventOnceSafely({
  userId,
  itemId: id,
  type: "RESALE_COMPLETED",
  dedupeKey: `item:${id}:RESALE_COMPLETED`,
});
```

Do not store asking price in ProductEvent.

- [ ] **Step 4: Track clipboard success only**

Update `GeneratedCopy` props to accept `itemId` and pass it from `ResaleStepper`.

After:

```ts
await navigator.clipboard.writeText(generatedText);
```

fire:

```ts
void fetch("/api/analytics/events", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "RESALE_COPY_COPIED", itemId }),
  keepalive: true,
}).catch(() => undefined);
```

Never include `generatedText` in that request.

- [ ] **Step 5: Hook sale completion**

After existing `recordOwnedItemSale` succeeds, call once with:

```ts
dedupeKey: `item:${id}:SALE_COMPLETED`
```

Do not duplicate `soldPrice`, `channel`, or other SaleRecord fields in ProductEvent.

- [ ] **Step 6: Track actual usage-cost card render**

When `/api/report` returns `ready`, fire one client event per rendered sold item:

```ts
for (const item of body.items) {
  void postAnalytics({ type: "USAGE_COST_VIEWED", itemId: item.itemId });
}
```

No item name, price, usage cost, or report summary is transmitted.

- [ ] **Step 7: Add E2E privacy assertion**

Intercept `/api/analytics/events` during resale copy and assert request JSON equals:

```ts
{ type: "RESALE_COPY_COPIED", itemId: expect.any(String) }
```

and does not contain generated copy text, receipt data, item name, defect note, or price.

- [ ] **Step 8: Run and commit**

```bash
pnpm vitest run tests/integration/resale.test.ts tests/integration/sale-report.test.ts tests/integration/product-analytics.test.ts
pnpm test:e2e -- tests/e2e/resale-flow.spec.ts tests/e2e/product-analytics.spec.ts
pnpm typecheck
git add app components tests
git commit -m "feat: measure resale and post-sale engagement"
```

---

### Task 6: Funnel calculations and 180-day retention operation

**Files:**
- Create: `src/analytics/funnels.ts`
- Create: `src/analytics/funnels.test.ts`
- Create: `scripts/purge-product-events.mjs`
- Modify: `src/analytics/repository.ts`
- Modify: `package.json`
- Modify: `docs/research/2026-08-28-market-validation.md`

**Interfaces:**
- Produces: `getRegistrationFunnel(range)`
- Produces: `getRetentionCohort(range)`
- Produces: `getLifecycleActivation(range)`
- Produces: `getResaleFunnel(range)`
- Produces: `getPostSaleReportEngagement(range)`
- Produces: `deleteProductEventsBefore(cutoff): Promise<number>`
- Produces: `pnpm analytics:purge`

- [ ] **Step 1: Write pure calculation tests first**

Fixtures must cover:

```text
registration completion rate
median duration
p75 duration
D7 window = day 6..8 KST
D30 window = day 27..33 KST
lifecycle activation after registration only
resale started -> completed -> copied -> sold conversion
sale -> usage-cost viewed conversion
```

Use explicit UTC timestamps around KST midnight to catch timezone errors.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run src/analytics/funnels.test.ts
```

- [ ] **Step 3: Implement pure reducers and repository range loaders**

The public functions return aggregates, never raw event payloads to HTTP clients.

Example shape:

```ts
type RegistrationFunnel = {
  startedUsers: number;
  completedUsers: number;
  completionRate: number;
  medianDurationMs: number | null;
  p75DurationMs: number | null;
};
```

Use user/item distinct sets where the metric definition requires unique entities.

- [ ] **Step 4: Implement raw-event purge command**

`scripts/purge-product-events.mjs`:

```js
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
const result = await prisma.productEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } });
console.log(`deleted ${result.count} expired product events`);
await prisma.$disconnect();
```

Add:

```json
"analytics:purge": "node scripts/purge-product-events.mjs"
```

The deployment runbook must schedule this at least daily before analytics is enabled in production.

- [ ] **Step 5: Update market-validation measurement notes**

Document that actual success criteria now map to ProductEvent types and KST retention windows. Do not claim PMF before real user data exists.

- [ ] **Step 6: Run and commit**

```bash
pnpm vitest run src/analytics/funnels.test.ts tests/integration/product-analytics.test.ts
pnpm typecheck
git add src/analytics scripts package.json docs/research
git commit -m "feat: add product validation funnel metrics"
```

---

### Task 7: Privacy disclosure, full security regression, and release gate

**Files:**
- Modify: `app/privacy/page.tsx`
- Modify: `tests/integration/security-boundaries.test.ts`
- Modify: `tests/integration/forbidden-features.test.ts`
- Modify: `tests/e2e/release-acceptance.spec.ts`
- Modify: `tests/e2e/product-analytics.spec.ts`
- Modify: `.github/workflows/ci.yml` only if the current generic `pnpm test` / Playwright commands do not already include the new tests

**Interfaces:**
- Consumes all Tasks 1-6
- Produces release-gated privacy-safe analytics behavior

- [ ] **Step 1: Update privacy policy with first-party product analytics disclosure**

The page must explain in Korean that 다시값 collects limited internal usage records for product improvement, including event time, internal user/item identifiers, and registration duration where available; it must also state that receipts, sale-copy text, item free text, and advertising identifiers are not stored as analytics event content.

State raw usage-event retention as 180 days.

- [ ] **Step 2: Add forbidden-feature regression**

Extend scan/tests to fail if common third-party analytics/session replay packages are added without explicit review, including at minimum:

```text
posthog
mixpanel
amplitude
@vercel/analytics
hotjar
fullstory
```

Do not block unrelated package names by broad substring matching; inspect dependency keys.

- [ ] **Step 3: Add security regression**

Verify:

```text
unauthenticated analytics POST -> 401
server-only event type from client -> 400
cross-user item event -> ownership-safe not found/denied
extra sensitive-looking fields -> 400
raw analytics listing route -> absent
analytics responses -> no-store through existing authenticated API middleware
```

- [ ] **Step 4: Extend release E2E**

Release acceptance must prove:

```text
first item still registers if tracking start fails
copy still succeeds if analytics POST fails
sale completion still succeeds if analytics persistence is unavailable/mocked at safe wrapper level
no analytics request contains receipt URL or generated sale text
```

- [ ] **Step 5: Run full release verification**

```bash
pnpm prisma validate
pnpm prisma generate
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Expected: all PASS.

- [ ] **Step 6: Code Review Agent gate**

Review specifically for:

```text
no domain text leaking into ProductEvent
no analytics failure returned to successful product actions
no duplicate one-time funnel events
correct KST cohort boundaries
strict Zod rejection of unknown client fields
no public analytics read surface
```

- [ ] **Step 7: Security Agent gate**

Review specifically for:

```text
user/item ownership enforcement
userId/occurredAt spoof prevention
receipt/generatedText exclusion
retention disclosure and deletion path
third-party analytics absence
```

- [ ] **Step 8: Final commit**

```bash
git add .
git commit -m "test: enforce privacy-safe analytics release gate"
```

---

# Task DAG

```text
T1 ProductEvent storage + repository
 └─> T2 strict client event endpoint
      ├─> T3 first-item registration funnel
      └─> T4 visit retention + lifecycle activation
T1 ─────> T5 resale/sale/post-sale funnel
T3 + T4 + T5 ─> T6 funnel calculations + retention operation
T2~T6 ─────────> T7 privacy/security/full release gate
```

Parallel execution is allowed only after T2 where branches do not modify the same files. T3, T4, and T5 can be reviewed independently, but the final branch must integrate them before T6/T7.

# Self-review Result

## Spec coverage

- First-party only: T1/T2/T7
- Strict allowlist/no arbitrary payload: T1/T2/T7
- Registration start/completion/duration: T3
- Daily retention: T4/T6
- Lifecycle activation: T4/T6
- Resale start/completion/copy: T5/T6
- Sale completion/usage-cost engagement: T5/T6
- Analytics failure isolation: T1/T3/T4/T5/T7
- Ownership/privacy: T2/T7
- 180-day retention: T6/T7
- Internal aggregate functions without public dashboard: T6

No spec section is left without an implementation or explicit non-goal.

## Placeholder scan

No TBD/TODO/"implement later" placeholders remain. Every task includes concrete files, interfaces, test commands, and completion criteria.

## Type consistency

`ProductEventType`, `recordProductEvent`, `recordProductEventOnce`, `recordProductEventSafely`, `recordProductEventOnceSafely`, `resolveRegistrationDurationMs`, and `kstDateKey` are defined in T1 and consumed with the same names downstream.

## Scope check

The plan remains one subsystem: privacy-safe product validation analytics. It does not add an admin dashboard, marketing analytics, marketplace integrations, OCR, or external analytics vendors.
