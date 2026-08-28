# 다시값 MVP Release Checklist

- Candidate branch: `dasigap/security-production-auth`
- Verified candidate head: `07e6b8d7d30feba96f0a539f3d465bfcc5c4d49e`
- Release evidence: GitHub Actions CI #260
- CI run: https://github.com/BloomBouquet/dasigap/actions/runs/33183635068
- Result: **PASS — code readiness**
- Production rollout: **BLOCKED until Bouquet OAuth client registration and server configuration are provisioned**

## Design acceptance criteria

| Acceptance criterion | Status | Evidence |
| --- | --- | --- |
| 첫 물건 등록 플로우 정상 동작 | PASS | `pnpm test:e2e` → `tests/e2e/first-item.spec.ts` |
| 각 Item이 현재 로그인 사용자의 소유권으로 격리됨 | PASS | ownership/security integration suites + cross-user E2E |
| 영수증이 public URL로 노출되지 않음 | PASS | `receipt-privacy.spec.ts`; owner-only short-lived signed access |
| 영수증 삭제가 object storage까지 반영됨 | PASS | real S3-compatible MinIO PUT → signed GET → DELETE → GET 404 integration |
| 보증/반품 계산 테스트 통과 | PASS | lifecycle unit/integration tests + lifecycle E2E |
| 판매 준비 플로우 정상 완료 | PASS | `resale-flow.spec.ts` |
| 판매용 결과에 개인정보가 자동 삽입되지 않음 | PASS | resale privacy/template tests + E2E |
| 외부 플랫폼 자동 로그인/자동 게시 코드가 존재하지 않음 | PASS | `tests/integration/forbidden-features.test.ts` production-source scan |
| 판매 완료 및 실질 사용비 계산 테스트 통과 | PASS | sale/report and usage-cost tests + release acceptance E2E |
| 개인정보처리방침/서비스 이용약관 링크 위치 확보 | PASS | `home-pwa-legal.spec.ts` |

## Production authentication gates

| Gate | Status | Evidence |
| --- | --- | --- |
| OAuth2 Authorization Code + PKCE S256 사용 | PASS | `src/auth/bouquet-oauth.test.ts` + `bouquet-auth-boundary.spec.ts` |
| production Bouquet/base/redirect URL validation | PASS | insecure non-local HTTP rejection tests |
| OAuth state one-time consumption | PASS | `src/auth/auth-session.test.ts` |
| raw OAuth state를 DB에 저장하지 않음 | PASS | SHA-256 state hash persistence assertions |
| raw Dasigap session token을 DB에 저장하지 않음 | PASS | SHA-256 session hash persistence assertions |
| Bouquet access token을 DB session으로 교환 후 폐기 | PASS | SSO controller contract; session stores contain only local opaque session identity |
| callback browser state mismatch/replay 차단 | PASS | controller tests + HTTP boundary E2E |
| 외부 `returnTo` / open redirect 차단 | PASS | controller tests + HTTP boundary E2E |
| session cookie HttpOnly + SameSite=Lax | PASS | session/controller tests + HTTP boundary E2E |
| HTTPS production session cookie Secure | PASS | cookie unit tests |
| logout이 DB session과 browser cookie를 무효화 | PASS | session/controller tests + HTTP boundary E2E |
| production에서 dev auth 금지 | PASS | `src/auth/server-auth.test.ts` |
| production Bouquet API 인증은 local session cookie만 신뢰 | PASS | `src/auth/session-auth-adapter.test.ts`; dev header/raw cookie userId 미신뢰 |
| OAuth 오류에 code/token/upstream body를 노출하지 않음 | PASS | SSO controller generic error tests |

## Additional release gates

| Gate | Status | Evidence |
| --- | --- | --- |
| Frozen dependency installation | PASS | CI #260 `pnpm install --frozen-lockfile` |
| Prisma schema validation | PASS | CI #260 `pnpm prisma validate` |
| Deployed database migrations | PASS | CI #260 `pnpm prisma migrate deploy` including auth tables |
| TypeScript strict verification | PASS | CI #260 `pnpm typecheck` |
| Unit / integration / security / forbidden-feature suite | PASS | CI #260 |
| Real S3-compatible signed URL semantics | PASS | pinned MinIO integration in CI #260 |
| Production build | PASS | CI #260 `pnpm build` |
| Full browser release suite | PASS | CI #260 `pnpm test:e2e`, including Bouquet auth HTTP boundary |

## Required E2E scenario coverage

1. PASS — first item registration
2. PASS — item detail lifecycle display
3. PASS — receipt upload and owner-only access
4. PASS — resale preparation and copy
5. PASS — sold record
6. PASS — report shows usage cost and sale profit correctly
7. PASS — user B cannot access user A resource
8. PASS — document deletion removes storage object
9. PASS — Bouquet authorization start emits OAuth2 + PKCE redirect and state cookie
10. PASS — external auth return target is rejected
11. PASS — OAuth callback state mismatch is rejected without upstream exchange
12. PASS — logout clears the local session cookie

## Forbidden-feature review

Release remains blocked if production code adds any of the following without a separate approved scope and legal/technical review:

- marketplace password or credential storage
- automatic marketplace login, posting, or cross-posting
- Carrot/Bunjang scraping jobs
- internal buyer/seller chat, payment, or escrow

The production-source scan remains part of every CI run.

## Production rollout prerequisites

The code is merge-ready only. Actual `AUTH_MODE=bouquet` rollout must not happen until all of the following are completed outside this repository:

1. Bouquet OAuth client `dasigap` is registered.
2. Exact production callback URI is allowlisted: `https://<dasigap-host>/api/auth/bouquet/callback`.
3. Server-only production environment contains `BOUQUET_AUTH_BASE_URL`, `BOUQUET_AUTH_APP_ID`, `BOUQUET_AUTH_REDIRECT_URI`, and optional client secret when required by the provider.
4. `AUTH_MODE=bouquet` is explicitly set in production.
5. Database migration deployment completes before the new application process receives traffic.
6. A real browser login smoke test confirms authorize → callback → local session → authenticated API → logout.

No production environment may fall back automatically to development authentication.

## Final verification commands

```bash
pnpm install --frozen-lockfile
pnpm prisma validate
pnpm prisma migrate deploy
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

All required CI stages exited successfully in CI #260, including the dedicated real S3-compatible MinIO integration and the Bouquet authentication HTTP boundary E2E suite.

## Release decision

**PASS — code is ready for review/merge.**

**ROLLOUT BLOCKED — production authentication must remain disabled until the external Bouquet OAuth client registration, callback allowlist, production environment configuration, migration deployment, and real login smoke test are completed.**
