# 다시값 제품 검증 계측 설계

- Team: 장미 (Luna Agent System)
- Date: 2026-08-28
- Status: Approved design

## 1. Goal

MVP 이후 실제 사용자 행동을 검증할 수 있도록 다시값 내부에 최소한의 1st-party 제품 계측을 추가한다.

검증 대상은 다음 퍼널이다.

`앱 방문 → 물건 등록 시작 → 물건 등록 완료 → 판매 준비 시작 → 판매 준비 완료 → 판매글 복사 → 판매 완료`

이를 기반으로 첫 등록 완료율/소요시간, D7/D30 재방문, 판매 준비 전환, 판매글 활용, 판매 완료 전환을 계산할 수 있어야 한다.

## 2. Non-goals

- 외부 분석 SDK(PostHog, GA, Amplitude 등) 도입
- 자유형 JSON 이벤트 payload 저장
- 제품명, 브랜드, 모델, 구매처, 영수증, 하자 메모, 생성 판매글 원문 저장
- 광고 식별자/기기 지문 수집
- 자동 마케팅 프로파일링
- 관리자 대시보드 UI

## 3. Event Model

허용 이벤트는 enum으로 고정한다.

- `APP_VISITED`
- `ITEM_REGISTRATION_STARTED`
- `ITEM_REGISTRATION_COMPLETED`
- `RESALE_STARTED`
- `RESALE_COMPLETED`
- `RESALE_COPY_COPIED`
- `SALE_COMPLETED`

`ProductEvent` 저장 필드:

- `id`: UUID
- `userId`: 인증 경계에서 얻은 사용자 식별자
- `itemId`: 관련 물건 UUID, 앱 방문/등록 시작은 null
- `type`: 위 enum
- `durationMs`: 등록 완료 이벤트에서만 선택적으로 저장
- `createdAt`: 서버 시간

임의 문자열 metadata를 저장하지 않는다.

## 4. Trust Boundary

서버가 신뢰할 수 있는 성공 이벤트는 성공한 도메인 작업과 함께 기록한다.

- `ITEM_REGISTRATION_COMPLETED`: 물건 생성 성공 후 기록
- `SALE_COMPLETED`: 판매 완료 트랜잭션 내부에서 기록

클라이언트 상호작용 이벤트는 `/api/product-events`로 전송한다.

- `APP_VISITED`
- `ITEM_REGISTRATION_STARTED`
- `RESALE_STARTED`
- `RESALE_COMPLETED`
- `RESALE_COPY_COPIED`

서버는 `userId`를 요청 body에서 받지 않고 인증 경계에서 결정한다.

`itemId`가 필요한 이벤트는 현재 사용자 소유권을 검증한다.

## 5. Registration Duration

`ItemForm`이 mount될 때 `performance.now()`를 기준으로 시작 시간을 보관한다.

물건 등록 POST 시 `x-dasigap-registration-duration-ms` 헤더에 경과 시간을 정수로 보낸다.

서버는 값을 신뢰 데이터로 사용하지 않고 분석 참고값으로만 저장한다. 허용 범위는 `0..3,600,000ms`이며 범위를 벗어나거나 파싱 실패 시 `durationMs = null`로 기록한다.

## 6. Visit Dedupe

`AppVisitTracker`는 앱 셸에서 동작한다.

같은 브라우저에서 하루에 여러 페이지를 방문해도 `APP_VISITED` 전송을 과도하게 반복하지 않도록 `localStorage`에 로컬 날짜 키를 기록한다.

스토리지 접근이 차단된 환경에서는 계측 실패가 제품 사용을 막지 않는다. 계측 요청 실패도 사용자 화면에 오류를 표시하지 않는다.

## 7. Resale Events

`ResaleStepper`가 첫 로드 성공 후 `RESALE_STARTED`를 best-effort로 1회 전송한다.

Step 5 저장 성공 후 Step 6 결과 화면으로 이동할 때 `RESALE_COMPLETED`를 전송한다.

`GeneratedCopy`에서 clipboard 복사가 실제 성공한 뒤에만 `RESALE_COPY_COPIED`를 전송한다.

계측 실패는 판매 준비 자체를 실패시키지 않는다.

## 8. Sale Event

`recordOwnedItemSale` 트랜잭션에서 `SaleRecord` 생성 및 Item 상태 변경과 함께 `SALE_COMPLETED` 이벤트를 생성한다.

따라서 판매 완료 응답이 성공하면 이벤트도 함께 커밋되어야 한다.

## 9. Privacy & Security

- 이벤트 API는 인증 필수다.
- 클라이언트가 `userId`를 지정할 수 없다.
- item 관련 이벤트는 소유권 검증 후 기록한다.
- 자유형 payload를 허용하지 않는다.
- 영수증/문서 키, 구매자 정보, 판매글 내용, 하자 메모를 이벤트에 저장하지 않는다.
- 이벤트 API 응답에는 `Cache-Control: no-store`를 적용한다.
- 분석 이벤트 실패로 핵심 제품 작업을 되돌리지 않는다. 단, 서버 트랜잭션 이벤트(`SALE_COMPLETED`)는 해당 트랜잭션과 함께 원자적으로 처리한다.

## 10. Measurement Definitions

### First-item conversion

분모: `ITEM_REGISTRATION_STARTED` 고유 사용자
분자: `ITEM_REGISTRATION_COMPLETED` 고유 사용자

### Registration duration

`ITEM_REGISTRATION_COMPLETED.durationMs`의 median을 사용한다.

### D7 / D30 retention

기준일: 사용자 첫 `APP_VISITED` 날짜

- D7: 기준일 + 7일에 `APP_VISITED`가 있는 사용자 비율
- D30: 기준일 + 30일에 `APP_VISITED`가 있는 사용자 비율

향후 ±1일 윈도우가 필요하면 별도 정의 변경으로 다룬다.

### Resale completion

분모: `RESALE_STARTED` 고유 item
분자: `RESALE_COMPLETED` 고유 item

### Copy usage

분모: `RESALE_COMPLETED` 고유 item
분자: `RESALE_COPY_COPIED` 고유 item

### Sale completion

분모: `RESALE_STARTED` 고유 item
분자: `SALE_COMPLETED` 고유 item

## 11. Testing

- 이벤트 schema가 허용되지 않은 타입/필드를 거부하는 단위 테스트
- item 이벤트의 cross-user 소유권 차단 통합 테스트
- 등록 완료 이벤트에 duration이 기록되는 통합 테스트
- 판매 완료 트랜잭션에 `SALE_COMPLETED`가 같이 기록되는 통합 테스트
- 판매글 복사 성공 시에만 이벤트 API가 호출되는 UI 테스트 또는 E2E
- 이벤트 API 미인증 401 검증
- 기존 MVP E2E 전체 회귀

## 12. Release Gate

다음 조건을 모두 만족해야 merge 가능하다.

1. Prisma migration 적용 성공
2. typecheck 성공
3. unit/integration/security tests 성공
4. build 성공
5. Playwright 전체 release suite 성공
6. 이벤트 모델에 자유형 payload가 없음
7. 이벤트 API가 userId를 body에서 받지 않음
8. cross-user item 이벤트 기록 불가
