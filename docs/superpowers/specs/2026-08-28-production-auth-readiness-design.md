# 다시값 Production Auth Readiness Design

- Team: 장미 (Luna Agent System)
- Date: 2026-08-28
- Status: Approved implementation baseline
- Scope: Bouquet production authentication + persistent Dasigap session boundary

## 1. Goal

다시값 MVP의 기존 `AuthAdapter` 경계를 유지하면서 꽃다발 공통 인증을 실제 production 로그인 흐름으로 연결한다.

로그인 방식은 BloomBouquet에서 이미 검증한 OAuth2 Authorization Code + PKCE S256을 사용하고, OAuth access token은 다시값 도메인/API에 직접 전달하지 않는다. 꽃다발 `userinfo`에서 얻은 안정적인 `userId`만 다시값의 사용자 식별자로 사용한다.

## 2. Non-goals

이번 작업에는 다음을 포함하지 않는다.

- 다시값 전용 회원가입/비밀번호 시스템
- JWT 자체 발급/검증
- 꽃다발 access token 장기 저장
- refresh token 사용
- 사용자 프로필/닉네임 동기화
- 판매 준비 공유 링크
- 보증/반품 알림
- 카테고리별 등록 템플릿
- AI 시세/OCR/외부 마켓 자동 게시

## 3. Existing Boundary

기존 서버 도메인은 `AuthenticatedUser = { userId: string }`만 소비한다.

`AUTH_MODE=dev`는 development/test 전용이며 production에서는 계속 fail-closed 한다.

`AUTH_MODE=bouquet`는 production에서 다음 로컬 세션 경계를 통해 사용자 신원을 해석한다.

`Browser cookie -> Dasigap session token -> hashed DB lookup -> { userId }`

Item, Document, Resale, Report 등 기존 도메인에는 OAuth token, session token, 꽃다발 응답 객체를 전달하지 않는다.

## 4. OAuth Flow

### Login start

`GET /api/auth/bouquet/start?returnTo=/...`

1. server가 cryptographically random `state`를 만든다.
2. PKCE verifier/challenge를 생성한다.
3. raw state는 DB에 저장하지 않고 SHA-256 hash만 key로 사용한다.
4. DB에는 `codeVerifier`, 검증된 local `returnTo`, 5분 expiry를 저장한다.
5. browser에는 HttpOnly OAuth state cookie를 5분 동안 저장한다.
6. 꽃다발 `/authorize`로 302 redirect한다.

Authorization request parameters:

- `response_type=code`
- `client_id=<BOUQUET_AUTH_APP_ID>`
- `redirect_uri=<BOUQUET_AUTH_REDIRECT_URI>`
- `state=<opaque state>`
- `code_challenge=<S256 challenge>`
- `code_challenge_method=S256`

### Callback

`GET /api/auth/bouquet/callback?code=...&state=...`

1. query의 `code`, `state`가 모두 존재해야 한다.
2. OAuth state cookie와 query state가 동일해야 한다.
3. DB transient state는 단 한 번만 consume한다.
4. authorization code + PKCE verifier로 `/token`을 호출한다.
5. access token으로 `/userinfo`를 호출한다.
6. `userinfo.userId`, fallback `userinfo.sub` 중 안정적인 식별자를 추출한다.
7. 다시값 opaque session을 생성하고 raw token이 아닌 SHA-256 hash만 DB에 저장한다.
8. 브라우저에는 `dasigap_session` HttpOnly cookie를 설정한다.
9. OAuth state cookie를 삭제한다.
10. 검증된 local `returnTo`로 302 redirect한다.

OAuth access token은 callback 요청이 끝나면 폐기하며 DB에 저장하지 않는다.

### Logout

`POST /api/auth/logout`

1. `dasigap_session` cookie를 읽는다.
2. 존재하면 해당 hashed session row를 삭제한다.
3. session cookie를 즉시 만료시킨다.
4. 응답은 204로 고정한다.

## 5. Cookie Policy

Production cookie:

- name: `dasigap_session`
- `HttpOnly`
- `Secure` when callback URI is HTTPS
- `SameSite=Lax`
- `Path=/`
- default max age: 7 days

OAuth state cookie:

- name: `dasigap_oauth_state`
- `HttpOnly`
- `Secure` when callback URI is HTTPS
- `SameSite=Lax`
- `Path=/api/auth/bouquet`
- max age: 300 seconds

## 6. Persistent Data

### OAuthTransientState

- `stateHash String @id`
- `codeVerifier String`
- `returnTo String`
- `expiresAt DateTime`
- `createdAt DateTime @default(now())`

Transient state는 consume 시 삭제하며 expired rows도 write path에서 정리한다.

### AuthSession

- `tokenHash String @id`
- `userId String`
- `expiresAt DateTime`
- `createdAt DateTime @default(now())`

Index:

- `userId`
- `expiresAt`

Session token 원문은 DB에 저장하지 않는다.

## 7. Configuration

기존 다시값 환경변수 이름을 최대한 유지한다.

Required in production bouquet mode:

- `AUTH_MODE=bouquet`
- `DATABASE_URL`
- `BOUQUET_AUTH_BASE_URL`
- `BOUQUET_AUTH_APP_ID=dasigap`
- `BOUQUET_AUTH_REDIRECT_URI=https://<dasigap-host>/api/auth/bouquet/callback`

Optional:

- `BOUQUET_AUTH_APP_SECRET`
- `DASIGAP_POST_LOGIN_URL=/`

`BOUQUET_AUTH_BASE_URL`에서 `/authorize`, `/token`, `/userinfo`를 파생한다. production에서 base URL과 redirect URI는 HTTPS만 허용한다. localhost/127.0.0.1은 개발 테스트를 위해 HTTP를 허용한다.

실제 배포 issuer baseline은 `https://bloombouquet.https.gsmsv.site`이며 secret은 저장소에 커밋하지 않는다.

## 8. Server Auth Integration

`requireUser(request)` 동작:

- `AUTH_MODE=dev`: 기존 DevAuthAdapter 사용, production이면 configuration error
- `AUTH_MODE=bouquet`: `dasigap_session` cookie를 읽고 persistent session store에서 resolve
- session이 없거나 만료되면 `AuthenticationError(401)`
- DB/configuration 오류는 dev auth로 fallback하지 않는다

기존 `createRequireUser({ bouquetAdapter })` 테스트 seam은 유지하여 unit test에서 외부 DB 없이 경계를 검증할 수 있게 한다.

## 9. Security Rules

- OAuth `returnTo`는 `/`로 시작하는 same-origin local path만 허용한다.
- `//`, backslash, CR/LF가 포함된 return target은 거절한다.
- state와 session token은 opaque random value이며 DB에는 hash만 저장한다.
- callback state는 browser cookie + DB one-time record 둘 다 일치해야 한다.
- OAuth code/state/token을 error body 또는 log에 노출하지 않는다.
- production dev-auth는 계속 차단한다.
- access token은 저장하지 않는다.
- session cookie는 JavaScript에서 읽을 수 없도록 HttpOnly로 설정한다.
- authenticated API의 기존 `private, no-store` 정책을 유지한다.

## 10. Failure Semantics

- 잘못된 callback query: 400 `INVALID_OAUTH_CALLBACK`
- state mismatch/expired/reused: 400 `INVALID_OAUTH_STATE`
- Bouquet token/userinfo upstream 실패: 502 `BOUQUET_AUTH_FAILED`
- 미인증 API: 기존 401 semantics 유지
- production auth configuration missing/invalid: fail closed

사용자 응답에는 upstream token/body/stack trace를 포함하지 않는다.

## 11. Verification

필수 자동 검증:

1. config가 insecure production URL을 거절한다.
2. PKCE S256 challenge가 deterministic test vector와 일치한다.
3. login start가 state를 저장하고 authorize URL을 만든다.
4. 외부 returnTo/open redirect가 차단된다.
5. callback state mismatch/reuse/expiry가 차단된다.
6. token exchange가 `application/x-www-form-urlencoded`와 verifier를 사용한다.
7. userinfo의 `userId` 또는 `sub`를 안정적인 userId로 변환한다.
8. DB에 raw OAuth state/session token이 저장되지 않는다.
9. valid session만 `requireUser`에서 `{ userId }`를 반환한다.
10. logout이 DB session과 cookie를 모두 무효화한다.
11. production에서 dev auth가 계속 실패한다.
12. 기존 ownership/security/item/resale/report tests가 회귀 없이 통과한다.
13. Prisma migration deploy, typecheck, production build가 통과한다.

## 12. Release Boundary

이 PR이 merge되어도 실제 production 로그인은 꽃다발 OAuth client에 다시값 callback URI가 등록되고 서버 환경변수가 배치되기 전까지 활성화하지 않는다.

코드 기본값은 계속 fail-closed이며, secret/client registration이 준비되지 않은 환경에서 dev auth로 자동 fallback하지 않는다.
