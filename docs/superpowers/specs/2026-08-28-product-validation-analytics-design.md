# 다시값 제품 검증 계측 설계

- Team: 장미 (Luna Agent System)
- Initial approval: 2026-08-28
- Hardened: 2026-08-29
- Status: Implemented release candidate

## 1. Goal

MVP 이후 실제 사용자 행동을 검증할 수 있도록 다시값 내부에 최소한의 1st-party 제품 계측을 둔다.

핵심 퍼널은 다음과 같다.

`앱 방문 → 물건 등록 시작 → 물건 등록 완료 → 생애관리 사용 → 판매 준비 시작 → 판매 준비 완료 → 판매글 복사 → 판매 완료 → 사용비 리포트 조회`

이를 기반으로 첫 등록 완료율/소요시간, D7/D30 재방문, 생애관리 사용, 판매 준비 전환, 판매글 활용, 판매 완료 전환, 판매 후 사용비 확인 여부를 계산할 수 있어야 한다.

## 2. Non-goals

- 외부 분석 SDK(PostHog, GA, Amplitude, Mixpanel, Segment, Vercel Analytics 등) 도입
- 자유형 JSON 이벤트 payload 저장
- 제품명, 브랜드, 모델, 구매처, 영수증, 하자 메모, 생성 판매글 원문 저장
- 광고 식별자/기기 지문 수집
- 자동 마케팅 프로파일링
- 관리자 대시보드 UI

외부 분석 SDK 금지는 테스트로 회귀 방지한다.

## 3. Event Model

허용 이벤트는 Prisma enum으로 고정한다.

- `APP_VISITED`
- `ITEM_REGISTRATION_STARTED`
- `ITEM_REGISTRATION_COMPLETED`
- `ITEM_LIFECYCLE_UPDATED`
- `RESALE_STARTED`
- `RESALE_COMPLETED`
- `RESALE_COPY_COPIED`
- `SALE_COMPLETED`
- `USAGE_COST_VIEWED`

`ProductEvent` 저장 필드:

- `id`: UUID
- `userId`: 인증 경계에서 얻은 사용자 식별자
- `itemId`: 관련 물건 UUID, 필요하지 않은 이벤트는 null
- `type`: 위 enum
- `durationMs`: 등록 완료 이벤트에서만 선택적으로 저장
- `dedupeKey`: 서버가 생성하는 제한적 중복 방지 키, 일반 이벤트는 null
- `createdAt`: 서버 시간

임의 문자열 metadata는 저장하지 않는다.

## 4. Trust Boundary

### 서버 전용 성공 이벤트

다음 이벤트는 클라이언트 이벤트 API에서 허용하지 않는다.

- `ITEM_REGISTRATION_COMPLETED`
- `ITEM_LIFECYCLE_UPDATED`
- `SALE_COMPLETED`
- `USAGE_COST_VIEWED`

이벤트는 성공한 서버 도메인 작업 이후 서버가 직접 기록한다.

- `ITEM_REGISTRATION_COMPLETED`: 물건 생성 성공 후
- `ITEM_LIFECYCLE_UPDATED`: 보증/반품 정보, 구성품, 관리 이력 변경 성공 후
- `SALE_COMPLETED`: 판매 완료 트랜잭션 내부
- `USAGE_COST_VIEWED`: 사용비 리포트 조회 성공 후

### 클라이언트 상호작용 이벤트

`/api/product-events`는 아래 이벤트만 strict schema로 허용한다.

- `APP_VISITED`
- `ITEM_REGISTRATION_STARTED`
- `RESALE_STARTED`
- `RESALE_COMPLETED`
- `RESALE_COPY_COPIED`

서버는 `userId`를 body에서 받지 않고 인증 경계에서 결정한다. `itemId`가 필요한 이벤트는 현재 로그인 사용자의 소유권을 확인한다.

## 5. Registration Duration

브라우저가 보낸 duration 숫자를 신뢰하지 않는다.

1. `ItemForm` mount 시 `ITEM_REGISTRATION_STARTED` 요청
2. 서버가 이벤트를 생성하고 `eventId` 반환
3. 클라이언트는 물건 등록 요청에 `registrationStartEventId`만 전달
4. item route는 해당 metadata를 strict 도메인 payload에서 분리
5. 서버는 같은 인증 사용자의 `ITEM_REGISTRATION_STARTED.createdAt`과 완료 서버 시각의 차이로 `durationMs` 계산
6. 30분을 초과하거나 소유권/타입이 맞지 않으면 `durationMs = null`

기존 `x-dasigap-registration-duration-ms` 헤더는 분석 신뢰값으로 사용하지 않는다.

## 6. Visit Dedupe

`AppVisitTracker`의 localStorage는 불필요한 네트워크 요청을 줄이는 최적화일 뿐 정확성 경계가 아니다.

서버가 KST 기준 날짜를 계산하고 다음 `dedupeKey`를 만든다.

`visit:{userId}:{YYYY-MM-DD}`

`ProductEvent.dedupeKey` unique constraint와 Prisma upsert를 사용해 여러 탭·브라우저·기기의 동시 요청에서도 같은 사용자/KST 하루의 `APP_VISITED`는 한 건만 유지한다.

클라이언트는 날짜나 dedupe key를 지정할 수 없다.

## 7. Lifecycle Events

다음 도메인 변경 성공 후 `ITEM_LIFECYCLE_UPDATED`를 best-effort로 기록한다.

- 보증/반품 정보 변경
- 구성품 생성
- 구성품 보유 상태 변경
- 관리/수리/손상 이력 추가

조회만으로는 lifecycle update를 기록하지 않는다. cross-user 실패 요청도 이벤트를 만들지 않는다.

계측 실패는 해당 핵심 도메인 변경을 실패시키지 않는다.

## 8. Resale Events

- `RESALE_STARTED`: 판매 준비 데이터/구성품 첫 로드 성공 후 1회 전송
- `RESALE_COMPLETED`: Step 5 저장 성공 후 Step 6 결과 화면 진입 시 전송
- `RESALE_COPY_COPIED`: clipboard 복사가 실제 성공한 뒤에만 전송

클라이언트 요청은 `{ type, itemId }`만 포함하며 판매글 원문이나 하자 메모를 보내지 않는다.

## 9. Sale Event

`recordOwnedItemSale`의 Prisma 트랜잭션 안에서 다음을 함께 커밋한다.

- `SaleRecord` 생성
- Item 상태 `SOLD` 변경
- `SALE_COMPLETED` 생성

따라서 판매 완료 API가 성공하면 판매 데이터와 분석 이벤트가 원자적으로 존재한다.

## 10. Usage-cost Event

사용비 리포트 데이터를 소유권 범위에서 정상 조회한 뒤 `USAGE_COST_VIEWED`를 서버가 best-effort로 기록한다.

클라이언트가 이 이벤트를 직접 만들 수 없다.

## 11. Raw Event Retention

제품 검증용 raw `ProductEvent`에는 180일 보존 기준을 적용한다.

- cutoff: 서버 현재 시각 - 180일
- 새 서버 이벤트를 기록하기 전에 `createdAt < cutoff` 데이터를 삭제한다.
- 판매 완료의 서버 트랜잭션에서도 동일 cutoff 정리를 수행한다.
- `createdAt` 단독 index를 둬 retention delete 범위를 효율적으로 찾는다.

이 방식은 특정 호스팅 사업자나 cron 제품에 의존하지 않으며, 제품이 사용되어 서버 계측이 발생하는 동안 보존기간 초과 데이터가 자동 정리된다.

## 12. Privacy & Security

- 이벤트 API는 인증 필수
- client body의 `userId` 거부
- item 관련 client 이벤트는 소유권 검증
- 서버 전용 성공 이벤트는 client schema에서 거부
- 자유형 payload 금지
- 영수증/문서 키, 제품 상세 문자열, 구매자 정보, 판매글 원문, 하자 메모 미저장
- 광고 식별자/기기 지문 미수집
- 외부 제품 분석 SDK 미사용 및 CI 회귀 검사
- 이벤트 API 응답 `Cache-Control: no-store`
- 분석 실패는 핵심 제품 작업을 막지 않음. 단 `SALE_COMPLETED`는 판매 트랜잭션과 원자적 처리

개인정보처리방침에 제품 검증용 이용 기록의 항목, 목적, 비수집 정보, 180일 raw-event 보존 기준을 공개한다.

## 13. Measurement Definitions

### First-item conversion

- 분모: `ITEM_REGISTRATION_STARTED` 고유 사용자
- 분자: `ITEM_REGISTRATION_COMPLETED` 고유 사용자

### Registration duration

- 유효한 `ITEM_REGISTRATION_COMPLETED.durationMs`의 median

### D7 / D30 retention

- 기준일: 사용자별 첫 `APP_VISITED` KST 날짜
- D7: 정확히 기준일 + 7 KST 날짜에 방문 이벤트가 존재하는 사용자 비율
- D30: 정확히 기준일 + 30 KST 날짜에 방문 이벤트가 존재하는 사용자 비율

### Lifecycle usage

- `ITEM_LIFECYCLE_UPDATED` 이벤트 수
- 고유 사용자 수
- 고유 item 수

### Resale completion

- 분모: `RESALE_STARTED` 고유 item
- 분자: `RESALE_COMPLETED` 고유 item

### Copy usage

- 분모: `RESALE_COMPLETED` 고유 item
- 분자: `RESALE_COPY_COPIED` 고유 item

### Sale completion

- 분모: `RESALE_STARTED` 고유 item
- 분자: `SALE_COMPLETED` 고유 item

### Usage-cost usage

- `USAGE_COST_VIEWED` 조회 수
- 고유 조회 사용자 수

분모가 0이면 비율은 `0`으로 반환하고 NaN을 노출하지 않는다.

## 14. Aggregation

관리자 UI는 만들지 않는다.

`src/analytics/metrics.ts`의 pure aggregation 함수로 raw event를 집계하고, DB loader는 180일 보존 범위의 필요한 컬럼만 읽는다.

집계 결과는 현재 내부 검증/리서치용이며 공개 API를 추가하지 않는다.

## 15. Testing

- 허용되지 않은 client 이벤트/필드 거부
- 서버 전용 이벤트 client 위조 거부
- cross-user item 이벤트 차단
- server start event 기반 등록 duration
- legacy client duration 값 미신뢰
- KST 서버 일일 방문 dedupe
- 생애관리 성공 변경만 lifecycle event 생성
- 판매 완료 트랜잭션과 `SALE_COMPLETED` 원자성
- 사용비 조회 성공 후 server event 생성
- 판매글 clipboard 성공 시에만 copy event 전송
- 180일 초과 raw event 자동 삭제
- metric conversion/median/KST D7/D30/zero denominator 계산
- 외부 analytics SDK/package 금지
- 기존 전체 MVP E2E 회귀

## 16. Release Gate

다음 조건을 모두 만족해야 merge 가능하다.

1. Prisma schema validate 및 모든 migration deploy 성공
2. TypeScript typecheck 성공
3. unit/integration/security/forbidden-feature suite 성공
4. 실제 S3-compatible signed URL integration 성공
5. production build 성공
6. Playwright 전체 release suite 성공
7. 자유형 analytics payload 없음
8. client가 userId 또는 서버 전용 성공 이벤트를 위조할 수 없음
9. cross-user item analytics 기록 불가
10. raw event 180일 retention 테스트 통과
11. 외부 analytics SDK 없음
12. 개인정보처리방침 계측 고지 반영
