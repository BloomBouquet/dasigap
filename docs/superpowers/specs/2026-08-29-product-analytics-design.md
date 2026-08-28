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
4. 판매 준비 결과가 실제 복사 행동까지 이어진다.
5. 실제 판매 완료와 사용비 확인까지 한 사이클이 연결된다.

이번 계측은 광고·마케팅 추적이 아니라 제품 기능 유효성 검증만을 목적으로 한다.

## 2. 비목표

V1 계측에서는 다음을 하지 않는다.

- 외부 analytics SDK
- 자동 클릭/DOM 이벤트 수집
- 세션 리플레이
- 광고 식별자
- device fingerprint
- IP 기반 사용자 식별
- 자유형 `properties: JSON`
- 영수증/문서 내용
- 판매글 원문
- 제품명/브랜드/모델/구매처 자유 텍스트
- 구성품명/하자 메모/수리 메모

## 3. 핵심 원칙

### 3.1 First-party only

이벤트는 다시값 서버와 PostgreSQL 내부에서만 저장한다.

### 3.2 Allowlist schema

이벤트 타입과 저장 필드를 코드/DB 스키마로 고정한다. 임의 metadata JSON은 허용하지 않는다.

### 3.3 Server-trusted completion

핵심 성공 이벤트는 실제 도메인 작업 성공 이후 서버에서 기록한다.

### 3.4 Non-blocking analytics

계측 저장 실패만으로 물건 등록·판매 준비·판매 완료 같은 핵심 제품 동작이 실패하면 안 된다.

### 3.5 최소 데이터

행동의 종류, 내부 식별자, 서버 시간, 필요한 경우 서버가 계산한 duration만 저장한다.

## 4. 데이터 모델

```text
ProductEvent
- id: UUID
- userId: String
- itemId: String?
- type: ProductEventType
- durationMs: Int?
- occurredAt: DateTime
```

정책:

- `userId`: 현재 인증 사용자 식별자.
- `itemId`: 특정 물건과 연결되는 이벤트에서만 저장.
- Item 삭제가 ProductEvent 때문에 막히지 않도록 `itemId`는 nullable + `onDelete: SetNull`을 기본안으로 한다.
- 실제 판매가격 등 도메인 값은 이벤트 테이블에 중복 저장하지 않는다.

### 4.1 이벤트 타입

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

## 5. 이벤트 정의

### ITEM_REGISTRATION_STARTED

발생:
- `/items/new`에서 등록 폼이 준비된 뒤 클라이언트가 `POST /api/analytics/events` 호출.

서버 응답:

```json
{ "eventId": "..." }
```

이벤트 저장:
- `userId`
- `type`
- 서버 `occurredAt`

클라이언트는 반환받은 `eventId`를 메모리 상태에 보관하고 등록 제출 시 `registrationEventId`로 `/api/items`에 전달한다.

### ITEM_REGISTRATION_COMPLETED

발생:
- `POST /api/items`에서 Item 생성이 성공한 이후.

duration 계산:

1. 요청의 `registrationEventId` 조회
2. 현재 `userId` 소유 이벤트인지 확인
3. 타입이 `ITEM_REGISTRATION_STARTED`인지 확인
4. 완료 서버 시각 - 시작 이벤트 서버 시각 계산
5. 0 < duration <= 30분이면 저장
6. 유효하지 않으면 `durationMs = null`

중요:
- duration 검증 실패는 Item 생성을 실패시키지 않는다.
- 클라이언트 timestamp를 신뢰하지 않는다.

### APP_VISITED

발생:
- 인증된 앱 셸이 브라우저에 실제 마운트될 때 클라이언트가 이벤트 API 호출.

중복 억제:
- 사용자별 KST calendar date당 최대 1건.

목적:
- D1/D7/D30 재방문 cohort 계산.

### ITEM_LIFECYCLE_UPDATED

발생:
- 반품/보증 정보, 구성품, 유지보수/수리, 상태 등 장기 관리 정보가 성공적으로 변경된 뒤 서버에서 기록.

규칙:
- 같은 API 요청에서 여러 row가 바뀌어도 이벤트는 1건.

### RESALE_STARTED

발생:
- 특정 item의 최초 resale draft가 서버에서 생성된 시점.

중복 억제:
- item당 최초 1회.

### RESALE_COMPLETED

발생:
- 판매 준비 필수 데이터가 저장되고 `generatedText`가 생성되어 Step 6 결과를 제공할 수 있게 된 최초 시점.

중복 억제:
- item당 최초 1회.

### RESALE_COPY_COPIED

발생:
- 사용자가 판매 요약 복사 버튼을 눌렀고 Clipboard API가 성공한 후 클라이언트가 이벤트 API 호출.

금지:
- 복사한 텍스트 자체는 전송하지 않는다.

### SALE_COMPLETED

발생:
- Sale row 생성과 item 판매 완료 상태 반영이 성공한 이후 서버에서 기록.

금지:
- 판매가격은 ProductEvent에 저장하지 않는다.

### USAGE_COST_VIEWED

발생:
- 판매 완료 물건의 사용비 카드/리포트가 브라우저에 실제 노출된 뒤 클라이언트가 이벤트 API 호출.

중복 억제:
- 사용자+item 기준 KST 날짜당 최대 1건이면 충분하다.

## 6. 클라이언트 이벤트 API

```text
POST /api/analytics/events
```

클라이언트에서 생성 가능한 타입은 다음으로 제한한다.

```text
ITEM_REGISTRATION_STARTED
APP_VISITED
RESALE_COPY_COPIED
USAGE_COST_VIEWED
```

### 요청 예

```json
{
  "type": "RESALE_COPY_COPIED",
  "itemId": "..."
}
```

### 응답

- `ITEM_REGISTRATION_STARTED`: `201 { "eventId": "..." }`
- 나머지 성공: `204 No Content`

### 서버 검증

1. `requireUser`
2. 클라이언트 허용 타입 확인
3. 이벤트별 payload exact schema 확인
4. itemId가 필요한 이벤트면 `getOwnedItem`
5. `userId`와 `occurredAt`은 서버가 결정
6. no-store 응답

클라이언트는 다음 필드를 보낼 수 없다.

- `userId`
- `occurredAt`
- `durationMs`
- 임의 metadata

## 7. 서버 이벤트 인터페이스

```ts
recordProductEvent(input): Promise<ProductEvent>
recordProductEventOnce(input): Promise<ProductEvent | null>
recordProductEventNonBlocking(input): Promise<void>
```

역할:

- `recordProductEvent`: 검증 완료된 내부 이벤트 저장
- `recordProductEventOnce`: milestone 중복 억제
- `recordProductEventNonBlocking`: 핵심 도메인 성공 후 이벤트 실패를 삼키고 안전한 로그만 기록

로그에 자유 텍스트 payload를 남기지 않는다.

## 8. Idempotency

최초 1회가 중요한 이벤트:

- `RESALE_STARTED`
- `RESALE_COMPLETED`

일 단위 중복 억제:

- `APP_VISITED`: user + KST date
- `USAGE_COST_VIEWED`: user + item + KST date

V1 구현은 별도 milestone 테이블을 만들지 않는다. PostgreSQL/Prisma에서 무리 없는 unique 전략을 우선 사용하고, partial unique가 구조를 과도하게 복잡하게 만들면 transaction-safe existence check로 시작한다.

## 9. 퍼널 정의

### Funnel A — 첫 물건 등록

분모:
- 분석 기간 내 `ITEM_REGISTRATION_STARTED`가 있는 신규 사용자

분자:
- 같은 사용자의 `ITEM_REGISTRATION_COMPLETED`

지표:
- completion rate
- valid `durationMs` median / p75

초기 성공 기준:
- completion >= 70%
- median <= 180,000ms

### Funnel B — 재방문

cohort:
- 사용자 최초 `ITEM_REGISTRATION_COMPLETED` KST 날짜

retention window:
- D7: day 6~8
- D30: day 27~33

해당 window에 `APP_VISITED`가 있으면 retained로 본다.

### Funnel C — 장기 관리 행동

분모:
- 물건 등록 완료 사용자

분자:
- 이후 `ITEM_LIFECYCLE_UPDATED` 1회 이상 사용자

보조 지표:
- 첫 lifecycle update까지 경과 일수

### Funnel D — 판매 준비

item 기준 단계:

1. `RESALE_STARTED`
2. `RESALE_COMPLETED`
3. `RESALE_COPY_COPIED`
4. `SALE_COMPLETED`

지표:
- 단계별 conversion
- start → complete 시간
- complete → copy 비율
- copy → sale 비율

### Funnel E — 판매 후 가치

분모:
- `SALE_COMPLETED`

분자:
- 해당 item의 `USAGE_COST_VIEWED`

지표:
- 판매 완료 후 사용비 리포트 조회율

## 10. 집계 모듈

사용자에게 analytics dashboard는 만들지 않는다.

내부 함수만 구현한다.

```text
getRegistrationFunnel(range)
getRetentionCohort(range)
getLifecycleActivation(range)
getResaleFunnel(range)
getPostSaleReportEngagement(range)
```

구조:
- Prisma/SQL로 최소 row 집합 조회
- 테스트 가능한 순수 계산 함수에서 conversion/median/cohort 계산

관리 API/UI는 별도 승인 대상이다.

## 11. 개인정보/보안 경계

ProductEvent에 절대 저장하지 않는 값:

- 이름/이메일/전화번호/주소
- 주문번호/카드 정보
- 영수증 원본/OCR 결과
- 제품명/브랜드/모델/구매처 자유 텍스트
- 구성품명
- 하자/수리 메모
- 생성 판매글
- 외부 플랫폼 계정 정보

허용 식별자:
- 내부 `userId`
- 내부 `itemId`

보안:
- 사용자 이벤트 조회 public API 없음
- 이벤트 생성 endpoint만 노출
- 다른 사용자 itemId는 기존 ownership 정책과 동일하게 거부
- analytics response `Cache-Control: no-store`

## 12. 데이터 보존

- raw ProductEvent 보존 목표: 180일
- 사용자 계정 삭제 시 연결된 raw ProductEvent 삭제
- 장기 보존이 필요하면 추후 비식별 aggregate로 전환

자동 retention job은 이번 구현 범위에 넣지 않는다. 단, 운영 출시 전 정기 삭제 절차가 반드시 마련되어야 한다.

## 13. 인덱스

기본 후보:

```text
(userId, occurredAt)
(type, occurredAt)
(itemId, type, occurredAt)
```

일 단위 중복 억제 구현에 필요하면 별도 `eventDateKst` 컬럼을 추가할 수 있다. 추가 시 server-derived date만 저장하고 클라이언트 입력은 금지한다.

## 14. 데이터 흐름

### 첫 등록

```text
/items/new mount
 -> POST analytics ITEM_REGISTRATION_STARTED
 -> server stores start event and returns eventId
 -> user submits item + registrationEventId
 -> Item create success
 -> server verifies start event
 -> server calculates duration
 -> ITEM_REGISTRATION_COMPLETED
 -> response
```

### 앱 방문

```text
AppShell client marker mount
 -> POST APP_VISITED
 -> server deduplicates by user + KST date
```

### 판매 준비

```text
first resale draft create
 -> RESALE_STARTED once
 -> resale steps persist
 -> generatedText available
 -> RESALE_COMPLETED once
 -> clipboard success
 -> POST RESALE_COPY_COPIED
```

### 판매 완료

```text
POST sale
 -> Sale + Item update success
 -> SALE_COMPLETED
 -> report/card mounts in browser
 -> POST USAGE_COST_VIEWED
```

## 15. 장애 처리

analytics write 실패:
- 핵심 도메인 응답 성공 유지
- 이벤트 type과 error class 정도만 서버 로그
- 자유 텍스트 payload 로그 금지

client analytics endpoint 실패:
- 사용자 toast 없음
- 핵심 UX 방해 없음

예외:
- `ITEM_REGISTRATION_STARTED` 저장이 실패하면 `registrationEventId`가 없으므로 등록 duration만 null이 된다. 물건 등록 자체는 정상 진행한다.

## 16. 테스트 전략

### Unit

- client/server event allowlist
- exact payload schema
- start event 기반 duration 계산
- 30분 초과 duration null 처리
- KST date 계산
- median/p75
- retention window
- resale funnel conversion

### Integration

- unauthenticated client event = 401
- server-only event를 client endpoint로 보내면 reject
- 임의 property reject
- cross-user itemId reject
- 민감 필드 형태 입력 reject
- item create success 뒤 completion event 존재
- 잘못된 registrationEventId여도 Item은 생성되고 duration null
- RESALE_STARTED/COMPLETED 중복 억제
- sale success 뒤 SALE_COMPLETED 존재
- analytics insert 실패가 도메인 성공을 롤백하지 않음

### E2E

1. `/items/new` 진입 → start event
2. 첫 물건 등록 → completion + duration
3. lifecycle 정보 변경 → lifecycle event
4. 판매 준비 → start/complete
5. clipboard mock 성공 → copy event
6. 판매 완료 → sale event
7. 사용비 카드 실제 노출 → viewed event
8. 기대 funnel milestone 검증

## 17. 예상 변경 파일

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
app/api/items/[id]/lifecycle/route.ts
app/api/items/[id]/components/route.ts
app/api/items/[id]/maintenance/route.ts
app/api/items/[id]/resale/route.ts
app/api/items/[id]/sale/route.ts
components/app-shell.tsx
components/form/item-form.tsx
components/resale/generated-copy.tsx
components/usage-cost-card.tsx
tests/integration/analytics.test.ts
tests/e2e/product-funnel.spec.ts
```

## 18. 릴리스 게이트

1. 자유형 analytics metadata 저장 불가
2. 민감 도메인 텍스트 저장 위치 없음
3. cross-user item event 생성 거부
4. analytics 단독 실패로 핵심 도메인 요청 실패 금지
5. 등록 duration은 서버 start event 시간으로 계산
6. RESALE_STARTED/COMPLETED 중복 억제
7. SALE_COMPLETED는 실제 sale 성공 이후만 기록
8. APP_VISITED KST 일 단위 중복 억제
9. unit/integration/E2E 전부 통과
10. 기존 forbidden marketplace gate 통과
11. typecheck/build 통과

## 19. Agent 판단

### PM

기능 추가보다 검증 가능한 퍼널 확보가 먼저다. 계측 자체는 제품보다 작게 유지한다.

### Backend

기존 PostgreSQL/Prisma를 재사용한다. 별도 analytics service나 queue는 현재 단계에 과도하다.

### Frontend

클라이언트 이벤트는 브라우저에서만 확인할 수 있는 행동으로 제한한다.

### Security

자유형 metadata를 금지하고 민감 데이터 유입을 schema 수준에서 차단한다.

### Code Review

시장 검증 질문에 답하지 못하는 이벤트는 추가하지 않는다.

### Orchestrator

`1st-party + allowlist + server-trusted completion + non-blocking analytics`를 최종 원칙으로 확정한다.
