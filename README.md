# 다시값 (Dasigap)

구매한 물건의 구매 이후 생애를 관리하고, 개인정보를 노출하지 않은 상태로 중고 판매 준비까지 이어주는 mobile-first PWA입니다.

## MVP 원칙

- 다시값 V1은 중고거래 마켓플레이스가 아닙니다.
- 사용자 간 구매자/판매자 매칭, 내부 채팅, 결제, 에스크로를 제공하지 않습니다.
- 외부 중고 플랫폼을 무단 크롤링하거나 계정을 대신 로그인해 자동 게시하지 않습니다.
- 영수증과 구매 증빙은 private storage에만 저장합니다.
- 판매 준비 결과에 영수증 원본, 주문번호, 주소, 전화번호, 카드정보를 자동 포함하지 않습니다.

## 개발 방식

Luna Agent System을 사용하며 역할별 브랜치와 PR로 작업합니다.

- `dasigap/pm`
- `dasigap/frontend`
- `dasigap/backend`
- `dasigap/security`
- `dasigap/review`

통합 대상 브랜치는 `main`입니다.
