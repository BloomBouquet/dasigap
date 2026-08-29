# Validation Ops Console Design

- Project: 다시값 (Dasigap)
- Team: 장미 / Luna Agent System
- Date: 2026-08-29
- Status: Design review candidate
- Base: `main` at `67647283f86063b6b5eeceb7f7286dda7630addb`

## 1. Purpose

다시값은 1st-party 제품 검증 이벤트 수집과 집계 함수까지 구현되어 있지만, 운영자가 제품 검증 결과를 안전하게 확인할 표면이 없다. 현재 상태에서는 DB에 직접 접속하거나 코드를 실행해야만 첫 등록 완료율, D7/D30 재방문, 판매 준비 전환 등을 판단할 수 있다.

시장 검증 문서는 실제 사용자 신호를 확인하기 전에 V1.1 기능을 추가하지 않도록 요구한다. 따라서 다음 제품 작업은 새로운 사용자 기능보다 먼저, 이미 수집 중인 검증 데이터를 운영자가 안전하게 읽고 의사결정할 수 있는 내부 전용 Validation Ops Console을 제공하는 것이다.

## 2. Goals

1. 꽃다발 SSO로 인증된 운영자 중 명시적 allowlist 사용자만 검증 지표를 볼 수 있게 한다.
2. raw `ProductEvent`, raw `userId`, raw `itemId`를 UI/API에 노출하지 않고 집계값만 제공한다.
3. 첫 등록, 등록시간, D7/D30, 생애관리, 판매 준비/복사/판매, 사용비 조회를 한 화면에서 판단할 수 있게 한다.
4. 현재 retention 계산의 immature cohort 왜곡을 제거한다.
5. 운영자 자신의 내부 페이지 방문이 `APP_VISITED` 제품 지표에 섞이지 않게 한다.
6. 기존 꽃다발 SSO와 제품 analytics privacy boundary를 재사용하고 별도 관리자 계정/역할 DB를 추가하지 않는다.

## 3. Non-goals

이번 범위에는 다음을 포함하지 않는다.

- 사용자별 이벤트 목록 또는 drill-down
- raw ProductEvent 조회 API
- CSV/JSON export
- 운영자용 사용자 검색
- 관리자 역할 테이블 또는 권한 관리 UI
- 이벤트 삭제/수정 기능
- 실시간 스트리밍 analytics
- 외부 analytics SaaS 연동
- 임의 날짜 범위 필터
- V1.1 사용자 기능 구현

## 4. Chosen Architecture

### 4.1 Access model

관리자 권한은 서버 환경변수 `VALIDATION_ADMIN_USER_IDS`로 관리한다.

형식은 comma-separated opaque Bouquet user IDs이다.

```text
VALIDATION_ADMIN_USER_IDS=user-a,user-b,user-c
```

서버는 값을 trim하고 빈 항목을 버린 뒤 exact string match만 사용한다. 클라이언트는 allowlist 내용을 받을 수 없다.

환경변수가 없거나 파싱 결과가 비어 있으면 fail-closed한다. 이 상태에서 어떤 사용자도 validation data를 받을 수 없다. 운영 설정 오류를 일반 권한 거절과 구분하기 위해 내부 API는 인증 완료 후 `503 VALIDATION_ADMIN_NOT_CONFIGURED`를 반환한다. 응답에는 환경변수 값이나 허용 user ID를 포함하지 않는다.

### 4.2 Shared server guard

새 서버 모듈을 둔다.

```text
src/internal/validation-admin.ts
```

주요 인터페이스:

```ts
requireValidationAdmin(request: Request): Promise<{ userId: string }>
```

동작 순서:

1. 기존 `requireUser(request)`로 꽃다발 세션 인증
2. `VALIDATION_ADMIN_USER_IDS` 파싱
3. 설정 없음/빈 allowlist면 configuration error
4. 현재 `userId`가 allowlist에 없으면 authorization error
5. 허용된 경우에만 caller에 authenticated identity 반환

오류 의미:

- 인증 없음: 401
- 인증됨, allowlist 아님: 403
- allowlist 설정 없음: 503

페이지는 보안 경계가 아니다. 데이터 접근의 authoritative security boundary는 항상 서버 API guard이다.

### 4.3 Internal metrics API

새 endpoint:

```text
GET /api/internal/validation
```

처리:

1. `requireValidationAdmin(request)` 호출
2. `getValidationMetrics(now)` 호출
3. 집계 DTO만 반환
4. `Cache-Control: private, no-store`

금지되는 응답 필드:

- raw `userId`
- raw `itemId`
- ProductEvent id
- 개별 event timestamp 배열
- item name/brand/model/store
- 영수증/문서 정보
- 하자/수리 free text
- generated resale copy

응답 예시:

```json
{
  "generatedAt": "2026-08-29T04:00:00.000Z",
  "retentionDays": 180,
  "metrics": {
    "firstItem": {
      "startedUsers": 120,
      "completedUsers": 91,
      "conversionRate": 0.7583
    },
    "registrationDuration": {
      "sampleSize": 84,
      "medianMs": 126000
    },
    "retention": {
      "d7EligibleUsers": 60,
      "d7Users": 24,
      "d7Rate": 0.4,
      "d30EligibleUsers": 18,
      "d30Users": 5,
      "d30Rate": 0.2778
    },
    "resaleCompletion": {},
    "copyUsage": {},
    "saleCompletion": {},
    "lifecycle": {},
    "usageCost": {}
  }
}
```

### 4.4 Internal UI

새 페이지:

```text
/internal/validation
```

이 페이지는 운영 판단용 숫자만 보여주는 read-only console이다.

표시 영역:

1. 데이터 상태
   - generated time
   - raw retention: 180일
2. 첫 등록
   - started users
   - completed users
   - conversion %
   - median registration duration
3. retention
   - D7 eligible cohort / retained / rate
   - D30 eligible cohort / retained / rate
4. lifecycle activation
   - update count
   - unique users
   - unique items
5. resale funnel
   - started items
   - completed items / conversion
   - copied items / conversion
   - sold items / conversion
6. post-sale
   - usage-cost views
   - unique users

UI는 raw list, 사용자 ID, item ID를 표시하지 않는다.

페이지가 API에서 403을 받으면 `접근 권한이 없습니다.`만 표시한다. 503이면 `검증 콘솔 설정이 완료되지 않았습니다.`를 표시한다. 구체적인 allowlist 값은 표시하지 않는다.

## 5. AppShell / Analytics Isolation

현재 `app/layout.tsx`가 모든 페이지를 `AppShell`로 감싸고 있고, 인증된 모든 비-legal route에서 `AppVisitTracker`가 렌더된다. 따라서 `/internal/validation`을 그대로 추가하면 운영자의 검증 페이지 방문이 `APP_VISITED`에 들어간다.

`AppShell`은 다음 경로를 internal surface로 취급한다.

```text
pathname.startsWith("/internal/")
```

internal surface에서:

- 꽃다발 session check는 유지
- 로그인/로그아웃 동작은 유지
- `AppVisitTracker`는 렌더하지 않음
- `BottomNav`는 렌더하지 않음
- 제품 사용 화면과 혼동되지 않는 최소 internal shell 사용

로그아웃과 legal link는 유지한다.

익명 사용자가 `/internal/validation`에 직접 접근했을 때 로그인 후 원래 경로로 돌아갈 수 있도록 AppShell의 꽃다발 로그인 URL은 현재 pathname을 `returnTo`로 사용한다. 기존 `safeReturnTo()`가 local absolute path만 허용하므로 외부 open redirect는 허용하지 않는다.

## 6. Retention Metric Correction

### 6.1 Problem

현재 retention 집계는 각 사용자의 첫 `APP_VISITED` 날짜를 cohort 시작일로 사용하고 모든 방문 사용자를 D7/D30 분모에 포함한다. 이 방식은 다음 두 문제가 있다.

1. 제품 검증 기준으로 합의한 cohort는 첫 `ITEM_REGISTRATION_COMPLETED` 날짜여야 한다.
2. 가입/등록 후 7일 또는 30일이 지나지 않은 사용자까지 실패자로 분모에 포함될 수 있다.

### 6.2 Correct cohort definition

cohort start:

```text
사용자별 첫 ITEM_REGISTRATION_COMPLETED의 KST calendar date
```

retention windows:

```text
D7  = cohort date + day 6 through day 8
D30 = cohort date + day 27 through day 33
```

eligibility:

- D7 denominator에는 현재 KST 날짜가 cohort date + 8 이상인 사용자만 포함
- D30 denominator에는 현재 KST 날짜가 cohort date + 33 이상인 사용자만 포함

즉 전체 관찰 창이 끝난 사용자만 denominator에 들어간다.

retained:

- eligible user가 해당 window 안에 `APP_VISITED`를 하나 이상 가지면 retained

response fields:

```text
d7EligibleUsers
d7Users
d7Rate
d30EligibleUsers
d30Users
d30Rate
```

분모가 0이면 rate는 0을 반환하며 `NaN`을 허용하지 않는다.

### 6.3 Function boundary

현재 pure metric function은 deterministic test가 가능하도록 observation time을 명시적으로 받는다.

```ts
computeValidationMetrics(events, now)
```

`getValidationMetrics(now = new Date())`가 DB 이벤트를 읽은 뒤 pure function에 동일 `now`를 전달한다.

## 7. Security and Privacy Boundaries

### Authentication / authorization

- internal API는 unauthenticated caller에 401
- non-admin authenticated caller에 403
- admin config missing에 503
- environment allowlist is server-only
- admin access 여부를 client state나 localStorage로 판단하지 않음

### Data minimization

Internal API는 aggregates only 원칙을 적용한다.

운영 화면에서 분석에 필요하지 않은 식별자와 원문은 조회하지 않는다. `getValidationMetrics`도 기존대로 ProductEvent의 최소 필드만 읽는다.

### Caching

다음 응답은 모두 `private, no-store`이다.

- `/api/internal/validation`
- internal authorization error responses

브라우저나 shared cache에 validation data가 재사용되지 않게 한다.

### Logging

권한 거절 로그에 다음을 쓰지 않는다.

- full allowlist
- raw event data
- item identifiers
- sensitive product text

필요하면 error class와 route만 기록한다.

## 8. Failure Handling

- metrics DB query 실패: API 500, 화면에 일반적인 재시도 메시지
- admin config 없음: API 503, 설정 필요 메시지
- session 확인 실패: 기존 AppShell auth error UI 재사용
- non-admin: API 403, 권한 없음 표시
- empty metrics: 정상 200, 모든 count/rate를 0 또는 `medianMs: null`로 표현

Validation console 실패는 일반 사용자 제품 기능이나 ProductEvent 기록을 절대 막지 않는다.

## 9. Expected File Changes

구현 시 실제 repo를 다시 확인한 뒤 조정하되 현재 예상 경로는 다음과 같다.

```text
src/internal/validation-admin.ts
src/internal/validation-admin.test.ts
src/analytics/metrics.ts
src/analytics/metrics.test.ts
app/api/internal/validation/route.ts
app/internal/validation/page.tsx
components/internal/validation-console.tsx
components/app-shell.tsx
app/app-shell.css or app/globals.css
 tests/integration/internal-validation.test.ts
 tests/e2e/internal-validation.spec.ts
```

추가 DB migration은 예상하지 않는다.

## 10. TDD Acceptance Criteria

### Unit

1. allowlist parser trims entries and rejects empty configuration
2. exact user ID match only
3. D7 uses first registration completion cohort, not first visit
4. D7 window is days 6-8
5. D30 window is days 27-33
6. immature cohorts are excluded from denominators
7. empty denominator returns 0
8. median registration duration behavior remains unchanged

### Integration

1. unauthenticated internal metrics request → 401
2. authenticated non-admin → 403
3. missing/empty admin env → 503
4. allowlisted admin → 200
5. response has `Cache-Control: private, no-store`
6. response contains aggregate metrics only
7. serialized response does not contain seeded raw user IDs or item IDs
8. internal endpoint does not create ProductEvent

### E2E

1. admin opens `/internal/validation` and sees aggregate cards
2. non-admin sees access denied and no metrics
3. admin page visit does not increase `APP_VISITED`
4. internal page does not show BottomNav
5. anonymous internal route can start Bouquet login with safe `returnTo=/internal/validation`

## 11. Release Gates

Merge is blocked unless all are true:

1. no raw ProductEvent endpoint exists
2. no raw userId/itemId appears in internal API DTO
3. server allowlist is authoritative
4. missing admin config fails closed
5. non-admin is rejected server-side
6. internal route does not emit `APP_VISITED`
7. D7/D30 denominators exclude immature cohorts
8. retention is based on first item registration completion cohort
9. existing analytics privacy/180-day retention tests still pass
10. Bouquet SSO tests still pass
11. marketplace forbidden-feature tests still pass
12. TypeScript, unit/integration/security, MinIO, build, and Playwright suites pass

## 12. Agent Decisions

### PM

새 사용자 기능보다 먼저 validation loop를 닫는다. 실제 신호 없이 V1.1 기능을 추가하지 않는다.

### Backend

기존 Postgres/Prisma ProductEvent와 metrics function을 재사용한다. 별도 analytics DB/service는 추가하지 않는다.

### Frontend

내부 콘솔은 read-only aggregate cards에 한정한다. 사용자 drill-down과 export는 제외한다.

### Security

꽃다발 인증만으로 admin을 추론하지 않는다. 서버 환경변수 allowlist로 별도 authorization을 강제하고 raw identifiers는 응답하지 않는다.

### Code Review

`AppShell`의 internal-path 분기는 analytics isolation 목적에만 제한하고 unrelated shell refactor는 하지 않는다.

### Orchestrator

최종 선택은 `Bouquet SSO + server allowlist + aggregate-only API + internal analytics isolation + mature retention cohorts`이다.
