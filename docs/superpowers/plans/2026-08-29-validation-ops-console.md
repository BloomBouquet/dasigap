# Validation Ops Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 꽃다발 SSO로 인증된 allowlist 운영자만 privacy-safe 제품 검증 집계값을 확인할 수 있는 내부 Validation Ops Console을 만들고, D7/D30 retention cohort 계산을 제품 검증 정의에 맞게 바로잡는다.

**Architecture:** 기존 `ProductEvent`와 `src/analytics/metrics.ts`를 그대로 source of truth로 사용한다. 서버 환경변수 allowlist를 authoritative authorization boundary로 두고 `/api/internal/validation`은 aggregates-only DTO만 반환하며, `/internal/validation`은 해당 API를 읽는 read-only client console이다. 내부 페이지는 기존 `AppShell` 인증 흐름은 유지하되 `AppVisitTracker`와 `BottomNav`에서 격리한다.

**Tech Stack:** Next.js 16.3.3 + React 19.2.8 + TypeScript strict + PostgreSQL + Prisma 6.19.2 + Vitest 4.1.10 + Playwright 1.62.1 + pnpm 11.24.0 + Node >=22.13 <27

**Spec:** `docs/superpowers/specs/2026-08-29-validation-ops-console-design.md`

## Global Constraints

- 관리자 allowlist는 서버 환경변수 `VALIDATION_ADMIN_USER_IDS`의 comma-separated opaque Bouquet user IDs만 사용한다.
- allowlist는 trim 후 exact string match만 허용한다.
- `VALIDATION_ADMIN_USER_IDS`가 없거나 파싱 결과가 비어 있으면 fail-closed하고 인증 완료 요청에 `503 VALIDATION_ADMIN_NOT_CONFIGURED`를 반환한다.
- 인증 없음은 401, 인증된 non-admin은 403이다.
- internal API/UI는 raw `ProductEvent`, raw `userId`, raw `itemId`, event id, 개별 timestamp 배열, 제품명/구매처/문서/하자/판매글 원문을 노출하지 않는다.
- `/api/internal/validation`과 authorization error response는 `Cache-Control: private, no-store`를 사용한다.
- internal page 접근은 `APP_VISITED`를 생성하지 않는다.
- D7 cohort start는 사용자별 첫 `ITEM_REGISTRATION_COMPLETED`의 KST calendar date다.
- D7 retained window는 cohort date +6..+8, denominator는 observation date가 cohort +8 이상인 사용자만 포함한다.
- D30 retained window는 cohort date +27..+33, denominator는 observation date가 cohort +33 이상인 사용자만 포함한다.
- empty denominator rate는 0이며 `NaN`을 허용하지 않는다.
- raw ProductEvent retention은 기존 180일 정책을 그대로 사용한다.
- 외부 analytics SDK, 관리자 역할 DB, 사용자별 drill-down, export, raw analytics endpoint는 추가하지 않는다.
- 기존 Bouquet SSO, marketplace forbidden-feature, analytics privacy/retention 경계를 약화하지 않는다.

---

## File Structure

- `src/internal/validation-admin.ts`: 서버 allowlist parsing, configuration/authorization errors, `requireValidationAdmin` guard.
- `src/internal/validation-admin.test.ts`: allowlist parser와 exact-match 단위 테스트.
- `src/analytics/metrics.ts`: first-registration cohort 기반 D7/D30 eligible retention 계산.
- `src/analytics/metrics.test.ts`: KST window, immature cohort, first-registration cohort 회귀 테스트.
- `app/api/internal/validation/route.ts`: admin guard 적용 후 aggregates-only validation DTO 반환.
- `tests/integration/internal-validation.test.ts`: 401/403/503/200, no-store, raw ID 비노출, non-mutating 검증.
- `app/internal/validation/page.tsx`: 내부 검증 페이지 entry.
- `components/internal/validation-console.tsx`: internal metrics fetch/state/render만 담당하는 client component.
- `components/app-shell.tsx`: `/internal/*`에서 analytics tracker와 bottom navigation 격리, login returnTo 보존.
- `app/app-shell.css`: internal console/shell 스타일.
- `playwright.config.ts`: E2E 서버의 validation admin allowlist에 `e2e-user` 설정.
- `tests/e2e/internal-validation.spec.ts`: admin console, non-admin denial, navigation isolation, visit event isolation, anonymous returnTo 회귀.
- `docs/release/validation-ops-console-checklist.md`: 최종 release evidence와 security gates.

---

### Task 1: Server-Side Validation Admin Guard

**Files:**
- Create: `src/internal/validation-admin.ts`
- Create: `src/internal/validation-admin.test.ts`

**Interfaces:**
- Consumes: `requireUser(request: Request): Promise<{ userId: string }>` from `src/auth/server-auth.ts`
- Produces: `parseValidationAdminUserIds(value: string | undefined): Set<string>`
- Produces: `ValidationAdminConfigurationError`
- Produces: `ValidationAdminAuthorizationError`
- Produces: `requireValidationAdmin(request: Request): Promise<{ userId: string }>`

- [ ] **Step 1: Write failing allowlist tests**

Create `src/internal/validation-admin.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  ValidationAdminConfigurationError,
  parseValidationAdminUserIds,
} from "./validation-admin";

describe("validation admin allowlist", () => {
  it("trims comma-separated ids and drops empty entries", () => {
    expect([...parseValidationAdminUserIds(" user-a, user-b ,,user-c ")]).toEqual([
      "user-a",
      "user-b",
      "user-c",
    ]);
  });

  it("fails closed when configuration is missing or empty", () => {
    expect(() => parseValidationAdminUserIds(undefined)).toThrow(
      ValidationAdminConfigurationError,
    );
    expect(() => parseValidationAdminUserIds(" , , ")).toThrow(
      ValidationAdminConfigurationError,
    );
  });

  it("preserves exact opaque ids instead of partial matching", () => {
    const ids = parseValidationAdminUserIds("admin-1,admin-10");
    expect(ids.has("admin-1")).toBe(true);
    expect(ids.has("admin")).toBe(false);
    expect(ids.has("admin-10")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run src/internal/validation-admin.test.ts
```

Expected: FAIL because `src/internal/validation-admin.ts` does not exist.

- [ ] **Step 3: Implement the minimal server guard**

Create `src/internal/validation-admin.ts`:

```ts
import { requireUser } from "../auth/server-auth";

export class ValidationAdminConfigurationError extends Error {
  constructor() {
    super("validation_admin_not_configured");
    this.name = "ValidationAdminConfigurationError";
  }
}

export class ValidationAdminAuthorizationError extends Error {
  constructor() {
    super("validation_admin_forbidden");
    this.name = "ValidationAdminAuthorizationError";
  }
}

export function parseValidationAdminUserIds(value: string | undefined): Set<string> {
  const ids = new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

  if (ids.size === 0) throw new ValidationAdminConfigurationError();
  return ids;
}

export async function requireValidationAdmin(request: Request) {
  const user = await requireUser(request);
  const allowed = parseValidationAdminUserIds(process.env.VALIDATION_ADMIN_USER_IDS);
  if (!allowed.has(user.userId)) throw new ValidationAdminAuthorizationError();
  return user;
}
```

Do not export the parsed allowlist or put its values in thrown error messages.

- [ ] **Step 4: Verify GREEN and type safety**

Run:

```bash
pnpm exec vitest run src/internal/validation-admin.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/internal/validation-admin.ts src/internal/validation-admin.test.ts
git commit -m "feat: add validation admin guard"
```

---

### Task 2: Correct D7/D30 Retention Cohorts

**Files:**
- Modify: `src/analytics/metrics.ts`
- Modify: `src/analytics/metrics.test.ts`

**Interfaces:**
- Changes: `computeValidationMetrics(events: ValidationEvent[], now: Date)`
- Keeps: `getValidationMetrics(now = new Date())`
- Produces retention shape:

```ts
{
  d7EligibleUsers: number;
  d7Users: number;
  d7Rate: number;
  d30EligibleUsers: number;
  d30Users: number;
  d30Rate: number;
}
```

- [ ] **Step 1: Replace the old exact-day retention test with failing cohort-window tests**

Add/replace tests in `src/analytics/metrics.test.ts` so all calls pass an explicit observation time:

```ts
it("uses first registration completion as the KST retention cohort", () => {
  const metrics = computeValidationMetrics(
    [
      event("APP_VISITED", "u1", "2026-07-20T00:00:00.000Z"),
      event("ITEM_REGISTRATION_COMPLETED", "u1", "2026-08-01T00:00:00.000Z", { itemId: "i1" }),
      event("APP_VISITED", "u1", "2026-08-07T00:00:00.000Z"),
    ],
    new Date("2026-08-10T00:00:00.000Z"),
  );

  expect(metrics.retention).toMatchObject({
    d7EligibleUsers: 1,
    d7Users: 1,
    d7Rate: 1,
  });
});

it("accepts D7 days 6 through 8 and excludes immature cohorts", () => {
  const metrics = computeValidationMetrics(
    [
      event("ITEM_REGISTRATION_COMPLETED", "eligible", "2026-08-01T00:00:00.000Z", { itemId: "i1" }),
      event("APP_VISITED", "eligible", "2026-08-09T00:00:00.000Z"),
      event("ITEM_REGISTRATION_COMPLETED", "immature", "2026-08-05T00:00:00.000Z", { itemId: "i2" }),
    ],
    new Date("2026-08-10T00:00:00.000Z"),
  );

  expect(metrics.retention.d7EligibleUsers).toBe(1);
  expect(metrics.retention.d7Users).toBe(1);
});

it("uses D30 days 27 through 33 after the whole window is observable", () => {
  const metrics = computeValidationMetrics(
    [
      event("ITEM_REGISTRATION_COMPLETED", "u1", "2026-07-01T00:00:00.000Z", { itemId: "i1" }),
      event("APP_VISITED", "u1", "2026-07-29T00:00:00.000Z"),
    ],
    new Date("2026-08-04T00:00:00.000Z"),
  );

  expect(metrics.retention).toMatchObject({
    d30EligibleUsers: 1,
    d30Users: 1,
    d30Rate: 1,
  });
});
```

Update existing aggregate tests to call `computeValidationMetrics(events, observationDate)` and assert eligible denominators instead of `cohortUsers`.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run src/analytics/metrics.test.ts
```

Expected: FAIL because the function currently takes one argument and uses first APP_VISITED + exact day 7/30.

- [ ] **Step 3: Implement first-registration cohort and observation eligibility**

In `src/analytics/metrics.ts`, build the earliest registration-completed KST date per user and APP_VISITED date sets. Use deterministic date-key helpers:

```ts
function firstRegistrationDates(events: ValidationEvent[]) {
  const result = new Map<string, string>();
  for (const event of events) {
    if (event.type !== "ITEM_REGISTRATION_COMPLETED") continue;
    const dateKey = kstDateKey(event.createdAt);
    const current = result.get(event.userId);
    if (!current || dateKey < current) result.set(event.userId, dateKey);
  }
  return result;
}

function hasVisitBetween(dates: Set<string>, start: string, end: string) {
  return [...dates].some((date) => date >= start && date <= end);
}
```

Change the function boundary:

```ts
export function computeValidationMetrics(events: ValidationEvent[], now: Date) {
  const observationDate = kstDateKey(now);
  const cohorts = firstRegistrationDates(events);
  // ...existing first-item/resale/lifecycle logic remains unchanged...

  let d7EligibleUsers = 0;
  let d7Users = 0;
  let d30EligibleUsers = 0;
  let d30Users = 0;

  for (const [userId, cohortDate] of cohorts) {
    const visits = visitDatesByUser.get(userId) ?? new Set<string>();
    const d7Start = addCalendarDays(cohortDate, 6);
    const d7End = addCalendarDays(cohortDate, 8);
    const d30Start = addCalendarDays(cohortDate, 27);
    const d30End = addCalendarDays(cohortDate, 33);

    if (observationDate >= d7End) {
      d7EligibleUsers += 1;
      if (hasVisitBetween(visits, d7Start, d7End)) d7Users += 1;
    }
    if (observationDate >= d30End) {
      d30EligibleUsers += 1;
      if (hasVisitBetween(visits, d30Start, d30End)) d30Users += 1;
    }
  }

  return {
    // ...
    retention: {
      d7EligibleUsers,
      d7Users,
      d7Rate: rate(d7Users, d7EligibleUsers),
      d30EligibleUsers,
      d30Users,
      d30Rate: rate(d30Users, d30EligibleUsers),
    },
  };
}
```

Update DB wrapper to use the same observation time:

```ts
return computeValidationMetrics(events, now);
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm exec vitest run src/analytics/metrics.test.ts
pnpm typecheck
```

Expected: PASS, including zero-rate and median-duration regressions.

- [ ] **Step 5: Commit**

```bash
git add src/analytics/metrics.ts src/analytics/metrics.test.ts
git commit -m "fix: correct validation retention cohorts"
```

---

### Task 3: Aggregates-Only Internal Validation API

**Files:**
- Create: `app/api/internal/validation/route.ts`
- Create: `tests/integration/internal-validation.test.ts`

**Interfaces:**
- Consumes: `requireValidationAdmin(request)`
- Consumes: `getValidationMetrics(now)`
- Consumes: `PRODUCT_EVENT_RETENTION_DAYS`
- Produces: `GET /api/internal/validation`

DTO:

```ts
type ValidationApiResponse = {
  generatedAt: string;
  retentionDays: 180;
  metrics: ReturnType<typeof computeValidationMetrics>;
};
```

- [ ] **Step 1: Write failing integration tests for all access states**

Create `tests/integration/internal-validation.test.ts`. Use `AUTH_MODE=dev`, `NODE_ENV=test`, and `x-dasigap-dev-user` like the existing product-event tests.

Required cases:

```ts
it("returns 401 without authentication", async () => {
  vi.stubEnv("VALIDATION_ADMIN_USER_IDS", "validation-admin");
  const response = await GET(request(null));
  expect(response.status).toBe(401);
});

it("returns 503 when the admin allowlist is not configured", async () => {
  vi.stubEnv("VALIDATION_ADMIN_USER_IDS", "");
  const response = await GET(request("validation-admin"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: {
      code: "VALIDATION_ADMIN_NOT_CONFIGURED",
      message: "Validation console is not configured",
    },
  });
});

it("returns 403 to an authenticated non-admin", async () => {
  vi.stubEnv("VALIDATION_ADMIN_USER_IDS", "validation-admin");
  const response = await GET(request("ordinary-user"));
  expect(response.status).toBe(403);
});
```

For allowlisted admin, seed ProductEvents with deliberately recognizable raw IDs such as `private-validation-user-raw` and a real item UUID, then assert:

```ts
const response = await GET(request("validation-admin"));
expect(response.status).toBe(200);
expect(response.headers.get("cache-control")).toBe("private, no-store");
const serialized = JSON.stringify(await response.json());
expect(serialized).not.toContain("private-validation-user-raw");
expect(serialized).not.toContain(item.id);
```

Record ProductEvent count before and after GET and assert it is unchanged.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run tests/integration/internal-validation.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement explicit internal error mapping**

Create `app/api/internal/validation/route.ts` with no dependency on generic client API errors for 403/503:

```ts
import { getValidationMetrics } from "../../../../src/analytics/metrics";
import { PRODUCT_EVENT_RETENTION_DAYS } from "../../../../src/analytics/retention";
import { AuthenticationError } from "../../../../src/auth/server-auth";
import {
  ValidationAdminAuthorizationError,
  ValidationAdminConfigurationError,
  requireValidationAdmin,
} from "../../../../src/internal/validation-admin";

export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  try {
    await requireValidationAdmin(request);
    const now = new Date();
    const metrics = await getValidationMetrics(now);
    return json({
      generatedAt: now.toISOString(),
      retentionDays: PRODUCT_EVENT_RETENTION_DAYS,
      metrics,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
    }
    if (error instanceof ValidationAdminConfigurationError) {
      return json({ error: { code: "VALIDATION_ADMIN_NOT_CONFIGURED", message: "Validation console is not configured" } }, 503);
    }
    if (error instanceof ValidationAdminAuthorizationError) {
      return json({ error: { code: "FORBIDDEN", message: "Access denied" } }, 403);
    }
    return json({ error: { code: "INTERNAL_ERROR", message: "Validation metrics unavailable" } }, 500);
  }
}
```

Do not add a raw events route or query parameter that changes the aggregation scope.

- [ ] **Step 4: Verify GREEN and analytics non-mutation**

Run:

```bash
pnpm exec vitest run tests/integration/internal-validation.test.ts src/analytics/metrics.test.ts src/internal/validation-admin.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/internal/validation/route.ts tests/integration/internal-validation.test.ts
git commit -m "feat: add private validation metrics api"
```

---

### Task 4: Read-Only Validation Console and AppShell Isolation

**Files:**
- Create: `app/internal/validation/page.tsx`
- Create: `components/internal/validation-console.tsx`
- Modify: `components/app-shell.tsx`
- Modify: `app/app-shell.css`

**Interfaces:**
- Consumes: `GET /api/internal/validation`
- Produces: `/internal/validation` read-only aggregate console
- Changes AppShell behavior for `pathname.startsWith("/internal/")`

- [ ] **Step 1: Implement the console state model before styling**

Create `components/internal/validation-console.tsx` as a client component with these states:

```ts
type ValidationState =
  | { status: "loading" }
  | { status: "ready"; data: ValidationResponse }
  | { status: "forbidden" }
  | { status: "not-configured" }
  | { status: "error" };
```

Fetch exactly once on mount:

```ts
const response = await fetch("/api/internal/validation", { cache: "no-store" });
if (response.status === 403) return setState({ status: "forbidden" });
if (response.status === 503) return setState({ status: "not-configured" });
if (!response.ok) return setState({ status: "error" });
setState({ status: "ready", data: await response.json() });
```

Render only aggregate numbers. Use helpers:

```ts
function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function duration(ms: number | null) {
  if (ms === null) return "표본 없음";
  const seconds = Math.round(ms / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초` : `${seconds}초`;
}
```

Required visible labels:
- `Validation Ops`
- `첫 물건 등록`
- `D7 재방문`
- `D30 재방문`
- `생애관리 사용`
- `판매 준비 퍼널`
- `사용비 조회`

403 copy: `접근 권한이 없습니다.`
503 copy: `검증 콘솔 설정이 완료되지 않았습니다.`
500/network copy: `검증 지표를 불러오지 못했습니다.`

- [ ] **Step 2: Add the route page**

Create `app/internal/validation/page.tsx`:

```tsx
import { ValidationConsole } from "../../../components/internal/validation-console";

export default function ValidationPage() {
  return <ValidationConsole />;
}
```

- [ ] **Step 3: Isolate internal routes in AppShell**

Modify `components/app-shell.tsx`:

```ts
const isInternalPage = pathname.startsWith("/internal/");
```

Keep session checking for internal pages. Build login returnTo from current local pathname:

```ts
const returnTo = isPublicLegalPage ? "/" : pathname;
const loginHref = `/auth/bouquet/start?returnTo=${encodeURIComponent(returnTo)}`;
```

For authenticated render:

```tsx
<div className={isInternalPage ? "app-shell internal-app-shell" : "app-shell"}>
  {!isInternalPage && <AppVisitTracker />}
  <div className="app-shell-content">{children}</div>
  <LegalLinks />
  {!isInternalPage && <BottomNav />}
</div>
```

Keep logout available in the authenticated footer. Do not rely on this UI condition for authorization; server guard remains authoritative.

- [ ] **Step 4: Add minimal internal styles**

Append focused classes to `app/app-shell.css`, for example:

```css
.internal-app-shell {
  padding-bottom: 0;
}

.validation-console {
  display: grid;
  gap: 14px;
}

.validation-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.validation-card {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
}

.validation-value {
  margin: 8px 0 0;
  font-size: 24px;
  font-weight: 800;
}

@media (max-width: 420px) {
  .validation-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

No chart library or external analytics UI dependency.

- [ ] **Step 5: Verify static/type constraints**

Run:

```bash
pnpm typecheck
pnpm build
```

Expected: PASS and `/internal/validation` appears in the build route list.

- [ ] **Step 6: Commit**

```bash
git add app/internal/validation/page.tsx components/internal/validation-console.tsx components/app-shell.tsx app/app-shell.css
git commit -m "feat: add validation ops console"
```

---

### Task 5: Browser-Level Authorization and Analytics Isolation

**Files:**
- Modify: `playwright.config.ts`
- Create: `tests/e2e/internal-validation.spec.ts`
- Modify: `tests/e2e/bouquet-auth-shell.spec.ts`

**Interfaces:**
- E2E configured admin: `e2e-user`
- E2E non-admin: `validation-non-admin`

- [ ] **Step 1: Configure the E2E server allowlist**

Add to `playwright.config.ts` webServer env:

```ts
VALIDATION_ADMIN_USER_IDS: "e2e-user",
```

This is test-only and does not change production configuration.

- [ ] **Step 2: Write browser tests for admin and non-admin**

Create `tests/e2e/internal-validation.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

const headers = (userId: string) => ({ "x-dasigap-dev-user": userId });

test("allowlisted admin can view aggregate validation cards without product navigation", async ({ page }) => {
  await page.setExtraHTTPHeaders(headers("e2e-user"));
  await page.goto("/internal/validation");

  await expect(page.getByRole("heading", { name: "Validation Ops" })).toBeVisible();
  await expect(page.getByText("첫 물건 등록")).toBeVisible();
  await expect(page.getByText("D7 재방문")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toHaveCount(0);
});

test("authenticated non-admin sees denial and no metrics", async ({ page }) => {
  await page.setExtraHTTPHeaders(headers("validation-non-admin"));
  await page.goto("/internal/validation");

  await expect(page.getByText("접근 권한이 없습니다.")).toBeVisible();
  await expect(page.getByText("D7 재방문")).toHaveCount(0);
});
```

- [ ] **Step 3: Lock the no-APP_VISITED behavior at the network boundary**

In the admin test, register a route observer before `goto`:

```ts
const eventRequests: string[] = [];
page.on("request", (request) => {
  if (request.url().endsWith("/api/product-events")) eventRequests.push(request.method());
});

await page.goto("/internal/validation");
await expect(page.getByRole("heading", { name: "Validation Ops" })).toBeVisible();
expect(eventRequests).toEqual([]);
```

This directly proves AppVisitTracker is not mounted on the internal surface.

- [ ] **Step 4: Extend anonymous Bouquet login returnTo regression**

Add to `tests/e2e/bouquet-auth-shell.spec.ts`:

```ts
test("anonymous internal route preserves a safe local returnTo", async ({ page }) => {
  await page.context().setExtraHTTPHeaders({});
  await page.goto("/internal/validation");

  await expect(page.getByRole("link", { name: "꽃다발로 로그인" })).toHaveAttribute(
    "href",
    "/auth/bouquet/start?returnTo=%2Finternal%2Fvalidation",
  );
});
```

- [ ] **Step 5: Verify focused E2E GREEN**

Run:

```bash
pnpm test:e2e -- tests/e2e/internal-validation.spec.ts tests/e2e/bouquet-auth-shell.spec.ts
```

Expected: all focused browser tests PASS.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts tests/e2e/internal-validation.spec.ts tests/e2e/bouquet-auth-shell.spec.ts
git commit -m "test: cover validation console access boundaries"
```

---

### Task 6: Release Gate, Privacy Review, and PR

**Files:**
- Create: `docs/release/validation-ops-console-checklist.md`
- Modify implementation files only if verification exposes a defect.

**Interfaces:**
- Produces final verified branch suitable for PR to `main`.

- [ ] **Step 1: Run the focused security/privacy suite**

Run:

```bash
pnpm exec vitest run \
  src/internal/validation-admin.test.ts \
  src/analytics/metrics.test.ts \
  tests/integration/internal-validation.test.ts \
  tests/integration/product-analytics-hardening.test.ts \
  tests/integration/product-event-retention.test.ts \
  tests/integration/forbidden-features.test.ts \
  tests/integration/bouquet-sso.test.ts
```

Expected: PASS.

Manually inspect the internal API DTO and confirm there is no property named `userId`, `itemId`, `events`, `eventId`, or freeform metadata in the returned JSON.

- [ ] **Step 2: Run the repository's complete release gate**

Use the same sequence as `.github/workflows/ci.yml`:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm prisma validate
pnpm prisma migrate deploy
pnpm typecheck
pnpm test
# CI separately runs real MinIO S3 integration here
pnpm build
pnpm test:e2e
```

Expected: all commands PASS. GitHub Actions must also PASS the pinned real MinIO signed-URL integration before merge.

- [ ] **Step 3: Write release evidence**

Create `docs/release/validation-ops-console-checklist.md` after the final CI run is known. It must record:

```md
# Validation Ops Console Release Checklist

- Branch: `dasigap/validation-ops`
- Verified head: `<actual final SHA>`
- GitHub Actions run: `<actual run id>`
- Result: PASS

## Access Boundary
- [x] unauthenticated -> 401
- [x] non-admin -> 403
- [x] missing allowlist -> 503 fail-closed
- [x] allowlisted admin -> aggregate metrics only

## Privacy
- [x] raw ProductEvent is not exposed
- [x] raw userId/itemId is not returned
- [x] internal visit does not create APP_VISITED
- [x] Cache-Control is private, no-store

## Retention Definition
- [x] cohort starts at first ITEM_REGISTRATION_COMPLETED KST date
- [x] D7 window is +6..+8 with eligibility at +8
- [x] D30 window is +27..+33 with eligibility at +33

## Verification
- [x] Prisma validate/migrate
- [x] typecheck
- [x] Vitest full suite
- [x] real MinIO S3 integration
- [x] production build
- [x] Playwright full suite
```

Replace angle-bracket values with actual evidence before commit; never commit placeholders.

- [ ] **Step 4: Commit the verified release checklist**

```bash
git add docs/release/validation-ops-console-checklist.md
git commit -m "docs: record validation ops release gate"
```

Because this moves HEAD, run the full GitHub Actions CI on the checklist commit too. Do not claim final completion from the previous SHA.

- [ ] **Step 5: Final code/security review**

Review the complete diff against the spec and reject merge if any of these are true:

- an internal endpoint returns raw event rows or identifiers
- admin access is decided only in client code
- allowlist absence permits access
- internal route mounts `AppVisitTracker`
- D7/D30 include immature cohorts
- D7/D30 use first APP_VISITED instead of first registration completion
- external analytics dependency appears
- Bouquet authentication behavior regresses

- [ ] **Step 6: Open/update PR in the required repository format**

Title:

```text
feat : 검증 운영 콘솔 추가
```

Body must use exactly the user's required sections:

```md
# ✨ PR 내용

## 📝 코드 변경 사항
- ...

## 💡 변경 이유
- ...

## 🛠️ 구현 방법
- ...

## 📌 영향 범위
- ...

## ✅ 테스트
- ...

**테스트 결과 / 참고 사항**
- ...

## 🌿 반영 브랜치
- main
```

Use a draft PR until the final checklist HEAD CI is fully GREEN. Then verify mergeability, review threads, and requested blockers before squash merging.

---

## Task DAG

```text
Task 1 admin guard ───────┐
                          ├─> Task 3 internal API ──┐
Task 2 retention fix ─────┘                         │
                                                    ├─> Task 5 E2E boundaries ─> Task 6 release gate
Task 4 console/AppShell ────────────────────────────┘
```

Execution order is `1 -> 2 -> 3 -> 4 -> 5 -> 6`. Task 4 may start after Task 3's response DTO is fixed, but keep sequential execution in this branch so each commit has one reviewable responsibility.

## Self-Review

- Spec coverage: access model, fail-closed behavior, aggregate-only API, internal UI, AppShell analytics isolation, safe returnTo, D7/D30 cohort correction, privacy, failure handling, and release gates each map to a concrete task.
- Placeholder scan: implementation steps contain no TBD/TODO. The release checklist section explicitly requires actual SHA/run values before the file is created.
- Type consistency: `requireValidationAdmin`, `computeValidationMetrics(events, now)`, `d7EligibleUsers`, `d30EligibleUsers`, and `/api/internal/validation` names are consistent across tasks.
- Scope: no DB migration, external SDK, role table, raw event endpoint, export, date filters, or V1.1 user feature is introduced.
