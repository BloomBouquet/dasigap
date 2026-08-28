# 다시값 1st-party 제품 계측 설계

- Team: 장미 (Luna Agent System)
- Date: 2026-08-29
- Status: Design review candidate
- Scope: MVP 시장 검증을 위한 최소 1st-party product analytics

## 1. 목적

다시값 MVP가 실제 사용자 행동에서 다음 가설을 만족하는지 측정한다.

1. 신규 사용자가 첫 물건 등록을 완료한다.
2. 등록 이후 다시 돌아와 물건의 생애정보를 관리한다.
3. 장기 기록이 실제 판매 준비까지 이어진다.
4. 판매 준비 결과가 복사되어 외부 플랫폼 게시에 사용될 가능성이 있다.
5. 실제 판매 완료와 사용비 계산까지 한 사이클이 연결된다.

이번 계측은 마케팅 추적이나 광고 최적화 목적이 아니다. 제품 기능의 유효성을 검증하기 위한 최소 행동 데이터만 수집한다.

## 2. 비목표

V1 계측에서는 다음을 하지 않는다.

- 외부 analytics SDK 도입
- 사용자 행동 전체 자동 캡처
- DOM 클릭 전체 추적
- 세션 리플레이
- 광고 식별자 수집
- device fingerprint 생성
- IP 기반 사용자 식별
- 영수증/문서 내용 수집
- 판매글 원문 수집
- 제품명, 브랜드, 모델명, 구매처 등의 자유 텍스트를 이벤트 속성으로 수집
- 하자 메모, 수리 메모, 구성품명 등 도메인 텍스트 수집

## 3. 핵심 원칙

### 3.1 First-party only

이벤트는 다시값 서버와 PostgreSQL 내부에서만 저장한다. 제3자 분석 사업자에게 사용자 행동을 전송하지 않는다.

### 3.2 Allowlist schema

임의 `properties: JSON` 구조를 허용하지 않는다. 이벤트 종류별 허용 필드를 타입과 스키마로 고정한다.

### 3.3 No sensitive payload

계측은 행동의 존재와 시간만 기록하며, 문서·영수증·판매글·하자·수리 내용 자체를 기록하지 않는다.

### 3.4 Server-trusted completion

핵심 성공 이벤트는 가능한 한 서버에서 실제 도메인 작업 성공 이후 기록한다. 클라이언트가 임의로 성공 이벤트를 만들어 서버에 보내는 구조를 피한다.

### 3.5 Product analytics failure must not break product action

계측 저장 실패 때문에 물건 등록, 판매 준비 저장, 판매 완료 같은 핵심 기능이 실패하면 안 된다. 비즈니스 트랜잭션 성공 후 계측이 실패하면 서버 로그에 남기되 사용자 작업은 성공으로 유지한다.

## 4. 이벤트 모델

### 4.1 ProductEvent

```text
ProductEvent
- id: UUID
- userId: String
- itemId: String?        // 해당 이벤트가 특정 물건과 연결될 때만
- type: ProductEventType
- durationMs: Int?       // 허용 이벤트에서만
- occurredAt: DateTime
```

외래키 정책:

- `userId`는 공통 인증의 안정적인 사용자 식별자다.
- `itemId`는 해당 사용자 소유 물건과 연결되는 이벤트에만 사용한다.
- 계측 데이터 보존 때문에 Item 삭제가 막히지 않도록 `itemId`는 nullable이며 Item 삭제 시 `SET NULL` 또는 명시적 비식별 처리한다.

### 4.2 이벤트 타입

V1 allowlist:

```text
ITEM_REGISTRATION_STARTED
ITEM_REGISTRATION_COMPLETED
APP_VISITED
ITEM_LIFECYCLE_UPDATED
RESALE_STARTED
RESALE_COMPLETED
RESALE_COPY_COPIED
SALE_COMPLETED
USAGE_COST_VIEWED
```

## 5. 이벤트별 정의

### ITEM_REGISTRATION_STARTED

발생 조건:
- `/items/new`의 등록 폼이 사용자에게 준비된 뒤 1회.

저장 필드:
- userId
- type
- occurredAt

주의:
- 클라이언트 이벤트이므로 신뢰 가능한 성공 지표에는 사용하지 않는다.
- 첫 등록 완료 소요시간 계산을 위한 시작점으로만 사용한다.

### ITEM_REGISTRATION_COMPLETED

발생 조건:
- `POST /api/items`가 DB에 Item을 성공적으로 생성한 직후.

저장 필드:
- userId
- itemId
- durationMs (클라이언트 시작시간을 서버가 검증 가능한 범위로 전달한 경우에만)
- type
- occurredAt

`durationMs` 규칙:
- 0보다 커야 한다.
- 최대 30분으로 clamp/reject 한다.
- 없거나 비정상 값이면 null로 기록하고 등록 자체는 실패시키지 않는다.

### APP_VISITED

발생 조건:
- 인증된 사용자가 앱 셸을 로드한 날의 첫 방문.

중복 억제:
- 사용자별 KST calendar date 기준 최대 1건.

목적:
- D1/D7/D30 재방문 계산.

### ITEM_LIFECYCLE_UPDATED

발생 조건:
- 구성품, 반품/보증 정보, 유지보수/수리, 상태 등 장기 관리 정보 중 하나를 성공적으로 추가 또는 변경.

중복 억제:
- 같은 요청에서 여러 내부 row가 바뀌더라도 이벤트 1건.

### RESALE_STARTED

발생 조건:
- 사용자가 특정 item의 판매 준비 화면을 처음 진입하거나 최초 resale draft를 생성하는 시점.

권장 구현:
- 서버에서 최초 resale draft 생성 시 1회 기록.

### RESALE_COMPLETED

발생 조건:
- 판매 준비 Step 6에 도달할 만큼 필요한 데이터가 서버에 저장되고 `generatedText`가 생성된 최초 시점.

중복 억제:
- item당 최초 1회만 핵심 completion event로 기록.

### RESALE_COPY_COPIED

발생 조건:
- 사용자가 생성 판매 요약의 복사 버튼을 실제로 눌렀고 Clipboard API 호출이 성공했을 때.

저장 필드:
- userId
- itemId
- type
- occurredAt

금지:
- 복사한 문자열 자체를 서버로 보내지 않는다.

### SALE_COMPLETED

발생 조건:
- 실제 판매 완료 API가 Sale row와 item 상태를 성공적으로 반영한 이후.

저장 필드:
- userId
- itemId
- type
- occurredAt

금지:
- 이벤트 테이블에는 실제 판매가격을 중복 저장하지 않는다. 가격은 기존 Sale 도메인 테이블에서만 조회한다.

### USAGE_COST_VIEWED

발생 조건:
- 판매 완료된 물건의 사용비 결과가 사용자에게 실제 렌더링되는 시점.

목적:
- 판매 완료 후 리포트 소비 여부 확인.

## 6. 클라이언트 이벤트 API

클라이언트에서만 알 수 있는 이벤트는 다음 둘로 제한한다.

- `ITEM_REGISTRATION_STARTED`
- `RESALE_COPY_COPIED`

필요하면 `USAGE_COST_VIEWED`도 클라이언트 API를 사용하지만, 가능하면 서버 렌더 경계에서 처리한다.

API:

```text
POST /api/analytics/events
```

요청 예:

```json
{
  "type": "RESALE_COPY_COPIED",
  "itemId": "..."
}
```

서버 규칙:

1. `requireUser`
2. 이벤트 타입 allowlist 확인
3. itemId가 필요하면 `getOwnedItem`으로 소유권 검증
4. 이벤트별 허용 필드 외 입력 reject
5. 이벤트 저장
6. `204 No Content`

클라이언트는 `userId`, `occurredAt`을 보낼 수 없다. 서버가 현재 인증 사용자와 서버 시간을 사용한다.

## 7. 서버 이벤트 기록 인터페이스

```ts
recordProductEvent(input): Promise<void>
```

원칙:

- 도메인 API 성공 후 호출한다.
- 이벤트 기록 실패는 catch하여 운영 로그만 남긴다.
- 이벤트 저장 함수는 비즈니스 도메인 row를 수정할 수 없다.

중복이 중요한 이벤트에는 별도 idempotency helper를 제공한다.

```ts
recordProductEventOnce({ userId, itemId, type })
```

DB unique constraint 또는 transaction-safe existence check로 중복을 막는다.

## 8. 퍼널 정의

### Funnel A — 첫 물건 등록

분모:
- 분석 기간 내 `ITEM_REGISTRATION_STARTED`가 있는 신규 사용자

분자:
- 같은 사용자의 `ITEM_REGISTRATION_COMPLETED`

지표:
- completion rate
- 완료 사용자의 `durationMs` median / p75

시장 검증 목표:
- completion rate >= 70%
- median duration <= 180,000ms

### Funnel B — 재방문

cohort 기준:
- 사용자 최초 `ITEM_REGISTRATION_COMPLETED` 날짜

D7 retained:
- 최초 등록일 +7일 기준 허용 window에 `APP_VISITED` 존재

V1 권장 window:
- D7: day 6~8
- D30: day 27~33

정확한 calendar-day cohort는 KST 기준으로 계산한다.

### Funnel C — 장기 관리 행동

분모:
- 물건 등록 완료 사용자

분자:
- 등록 이후 `ITEM_LIFECYCLE_UPDATED`가 1건 이상 존재하는 사용자

보조 지표:
- 첫 lifecycle update까지 걸린 일수

### Funnel D — 판매 준비

분모:
- 등록된 item

단계:
1. `RESALE_STARTED`
2. `RESALE_COMPLETED`
3. `RESALE_COPY_COPIED`
4. `SALE_COMPLETED`

지표:
- 단계별 전환율
- resale start → completion 시간
- completion → copy 비율
- copy → actual sale 비율

### Funnel E — 판매 완료 후 가치

분모:
- `SALE_COMPLETED`

분자:
- `USAGE_COST_VIEWED`

지표:
- 사용비 리포트 조회율

## 9. 내부 리포트

V1에서는 사용자에게 analytics dashboard를 노출하지 않는다.

관리/운영용 집계 함수만 구현한다.

```text
getRegistrationFunnel(range)
getRetentionCohort(range)
getLifecycleActivation(range)
getResaleFunnel(range)
getPostSaleReportEngagement(range)
```

초기 구현은 SQL/Prisma aggregation + 테스트 가능한 순수 계산 함수 조합을 권장한다.

관리 API나 UI는 별도 승인 전에는 만들지 않는다. 필요할 때 read-only admin surface로 분리한다.

## 10. 개인정보 및 보안 경계

절대 이벤트에 저장하지 않는 값:

- 이름
- 이메일
- 전화번호
- 주소
- 주문번호
- 카드 정보
- 영수증 원본 및 OCR 텍스트
- 제품명 자유 텍스트
- 브랜드/모델/구매처 자유 텍스트
- 구성품명
- 하자/수리 메모
- 생성된 판매글
- 외부 중고 플랫폼 계정 정보

허용되는 식별자:

- 내부 userId
- 내부 itemId

보안:

- 사용자 이벤트 조회용 public API를 V1에 만들지 않는다.
- 클라이언트 이벤트 endpoint는 현재 사용자의 이벤트 생성만 가능하다.
- 다른 사용자 itemId를 넣으면 기존 ownership 정책과 동일하게 not-found/denied 처리한다.
- analytics response를 캐시하지 않는다.

## 11. 데이터 보존

초기 기본값:
- ProductEvent raw row: 180일
- 장기 cohort 판단에 필요한 집계치는 추후 비식별 aggregate로 전환 가능

V1에서는 자동 삭제 job까지 구현하지 않아도 되지만, schema와 문서에는 180일 정책을 명시한다. 실제 운영 배포 전에 retention job 또는 정기 정리 절차가 있어야 한다.

사용자가 계정을 삭제할 때:
- userId에 연결된 raw ProductEvent는 함께 삭제한다.

## 12. 데이터베이스 인덱스

필수 인덱스 후보:

```text
(userId, occurredAt)
(type, occurredAt)
(itemId, type, occurredAt)
```

idempotent 이벤트를 위해 필요한 경우 partial/compound unique 전략을 사용한다.

예:
- item당 최초 `RESALE_COMPLETED` 1회

Prisma/PostgreSQL 제약 한계 때문에 partial unique가 복잡하면 `ProductEventMilestone` 같은 별도 테이블을 만들지 말고, 우선 transaction 내 existence check + 테스트로 충분한지 검토한다. 새 테이블은 실제 race 문제가 확인될 때만 추가한다.

## 13. 데이터 흐름

### 첫 등록

```text
/items/new render
  -> client analytics ITEM_REGISTRATION_STARTED
  -> user submits
  -> POST /api/items
  -> Item create success
  -> record ITEM_REGISTRATION_COMPLETED
  -> response
```

### 판매 준비

```text
resale page
  -> first draft persisted
  -> RESALE_STARTED once
  -> steps saved
  -> generatedText created
  -> RESALE_COMPLETED once
  -> user clicks copy
  -> clipboard success
  -> POST analytics RESALE_COPY_COPIED
```

### 판매 완료

```text
POST sale
  -> Sale + Item domain update success
  -> SALE_COMPLETED
  -> usage cost report render
  -> USAGE_COST_VIEWED
```

## 14. 장애 처리

analytics write 실패:
- 제품 핵심 요청은 성공 유지
- `console.error` 또는 기존 server logger로 이벤트 타입과 error class만 기록
- 이벤트 payload 자유 텍스트는 로그에도 남기지 않는다.

client analytics endpoint 실패:
- 사용자에게 오류 toast를 노출하지 않는다.
- 제품 UX를 방해하지 않는다.

DB 장애가 비즈니스 DB와 analytics DB가 동일한 PostgreSQL에서 발생한 경우:
- 핵심 도메인 DB 작업 자체가 실패하는 것은 기존 API 오류 정책을 따른다.
- 도메인 성공 후 별도 analytics insert에서 발생한 오류만 non-blocking 처리한다.

## 15. 테스트 전략

### Unit

- 이벤트 타입별 payload allowlist
- duration validation/clamp
- funnel 계산
- retention KST calendar date 계산
- resale 단계 전환 계산

### Integration

- client endpoint는 unauthenticated 401
- 다른 사용자 itemId event 생성 불가
- 허용되지 않은 type reject
- 추가 임의 property reject
- 제품명/판매글 등 민감 속성 입력 reject
- item create success 후 completion event 존재
- resale 최초 완료 후 completion event 1건
- sale success 후 SALE_COMPLETED 존재
- analytics insert failure가 핵심 도메인 성공을 되돌리지 않음

### E2E

1. 신규 사용자 `/items/new`
2. 첫 물건 등록
3. DB/검증 endpoint 기준 started + completed 확인
4. 판매 준비 6단계 완료
5. 복사 버튼 동작
6. 판매 완료
7. 기대 funnel milestone이 모두 기록됨

브라우저 테스트에서 Clipboard API는 deterministic mock을 사용한다.

## 16. 기존 코드 변경 예상 범위

```text
prisma/schema.prisma
prisma/migrations/*
src/analytics/events.ts
src/analytics/schemas.ts
src/analytics/repository.ts
src/analytics/funnels.ts
src/analytics/*.test.ts
app/api/analytics/events/route.ts
app/api/items/route.ts
app/api/items/[id]/resale/route.ts
app/api/items/[id]/sale/route.ts
components/form/item-form.tsx
components/resale/generated-copy.tsx
components/app-shell.tsx (APP_VISITED 구현 방식에 따라)
tests/integration/analytics.test.ts
tests/e2e/product-funnel.spec.ts
```

## 17. 릴리스 게이트

다음 조건을 모두 만족해야 merge 후보가 된다.

1. analytics 이벤트는 allowlist 밖 property를 저장할 수 없다.
2. 민감 도메인 텍스트는 ProductEvent schema에 저장 위치가 없다.
3. cross-user item event 생성이 거부된다.
4. 핵심 도메인 요청은 analytics insert 실패만으로 실패하지 않는다.
5. ITEM_REGISTRATION_COMPLETED는 실제 Item 생성 성공 이후에만 발생한다.
6. RESALE_COMPLETED는 item당 중복 기록되지 않는다.
7. SALE_COMPLETED는 실제 Sale 성공 이후 발생한다.
8. 전체 unit/integration/E2E 테스트가 통과한다.
9. 기존 forbidden marketplace feature gate가 계속 통과한다.
10. build/typecheck가 통과한다.

## 18. Agent 판단

### PM

현재 단계에서 더 많은 기능보다 퍼널을 측정할 수 있는 것이 중요하다. 단, 계측 자체가 제품보다 커져서는 안 된다.

### Backend

기존 PostgreSQL과 Prisma를 재사용한다. 별도 analytics service나 message queue는 현재 트래픽과 검증 단계에 과도하다.

### Frontend

클라이언트 이벤트는 클라이언트에서만 알 수 있는 행동으로 제한한다. 자동 클릭 추적은 도입하지 않는다.

### Security

자유형 JSON metadata를 금지한다. 영수증/판매글 등 민감 데이터가 이벤트로 유출될 가능성을 스키마 수준에서 차단한다.

### Code Review

이벤트가 많아지는 것을 성공으로 보지 않는다. V1 시장 검증 질문에 답하지 못하는 이벤트는 추가하지 않는다.

### Orchestrator

`1st-party + allowlist + server-trusted completion + non-blocking analytics`를 구현 원칙으로 확정한다.
