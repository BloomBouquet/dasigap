# Production Auth Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 꽃다발 OAuth2 Authorization Code + PKCE S256 로그인과 PostgreSQL 기반 다시값 세션을 연결해 production `AUTH_MODE=bouquet`가 실제 사용자 인증을 처리하도록 만든다.

**Architecture:** OAuth code/token은 callback 경계에서만 사용하고, 꽃다발 `userinfo`의 userId를 다시값 opaque session으로 교환한다. OAuth state와 session token은 원문을 DB에 저장하지 않고 SHA-256 hash만 저장하며, 기존 도메인은 계속 `{ userId }`만 소비한다.

**Tech Stack:** Next.js 16 Route Handlers + TypeScript strict + Prisma/PostgreSQL + Web Crypto + Vitest

**Spec:** `docs/superpowers/specs/2026-08-28-production-auth-readiness-design.md`

## Global Constraints

- production dev-auth fallback 금지
- OAuth2 Authorization Code + PKCE S256만 사용
- OAuth access token/authorization code 장기 저장 금지
- `returnTo`는 same-origin local path만 허용
- raw OAuth state와 raw Dasigap session token은 DB 저장 금지
- session cookie는 HttpOnly, SameSite=Lax, production HTTPS에서 Secure
- 기존 API/도메인은 `AuthenticatedUser = { userId: string }`만 사용
- 외부 인증 오류 응답에 token/code/state/stack trace 노출 금지

---

### Task 1: Bouquet OAuth protocol core

**Files:**
- Create: `src/auth/bouquet-oauth.test.ts`
- Create: `src/auth/bouquet-oauth.ts`
- Create: `src/auth/opaque-secret-hash.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `loadBouquetOAuthConfig(env)`, `createPkcePair(verifier?)`, `buildAuthorizationUrl(config,input)`, `BouquetOAuthClient.exchangeCode()`, `BouquetOAuthClient.fetchIdentity()`
- Produces: `hashOpaqueSecret(value)`

- [ ] **Step 1: Write failing config/PKCE/client tests**

```ts
it("rejects insecure production bouquet base URLs", () => {
  expect(() => loadBouquetOAuthConfig({
    NODE_ENV: "production",
    BOUQUET_AUTH_BASE_URL: "http://example.com",
    BOUQUET_AUTH_APP_ID: "dasigap",
    BOUQUET_AUTH_REDIRECT_URI: "https://dasigap.example/api/auth/bouquet/callback",
  })).toThrow(/HTTPS/);
});

it("builds an S256 authorization request", async () => {
  const { challenge } = await createPkcePair("a".repeat(43));
  const url = new URL(buildAuthorizationUrl(config, { state: "state-1", codeChallenge: challenge }));
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
});
```

- [ ] **Step 2: Run `pnpm vitest run src/auth/bouquet-oauth.test.ts` and verify RED because module/functions do not exist**

- [ ] **Step 3: Implement minimal protocol core**

Config shape:

```ts
export interface BouquetOAuthConfig {
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  clientId: string;
  redirectUri: string;
  postLoginUrl: string;
  clientSecret?: string;
}
```

`BOUQUET_AUTH_BASE_URL` must derive `/authorize`, `/token`, `/userinfo`; `BOUQUET_AUTH_APP_ID` is client_id; optional `BOUQUET_AUTH_APP_SECRET` is included only in token exchange.

- [ ] **Step 4: Run focused test and then `pnpm typecheck`**

- [ ] **Step 5: Commit `feat: add bouquet oauth protocol core`**

### Task 2: Persistent OAuth state and Dasigap session

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260828230000_add_auth_session/migration.sql`
- Create: `src/auth/auth-session.test.ts`
- Create: `src/auth/auth-session.ts`

**Interfaces:**
- Produces: `TransientAuthStore.save/consume`
- Produces: `AuthSessionStore.create/resolve/revoke`
- Produces: `PrismaTransientAuthStore`, `PrismaAuthSessionStore`
- Produces: `DASIGAP_SESSION_COOKIE`, `buildSessionCookie`, `buildSessionClearCookie`, `sessionTokenFromCookie`

- [ ] **Step 1: Write failing persistence/cookie tests**

```ts
it("never persists the raw session token", async () => {
  const store = new PrismaAuthSessionStore(prisma, { createToken: () => "raw-session-token" });
  await store.create({ userId: userId });
  const rows = await prisma.authSession.findMany();
  expect(rows[0]?.tokenHash).not.toBe("raw-session-token");
});

it("builds an HttpOnly secure session cookie", () => {
  expect(buildSessionCookie("token", { secure: true })).toContain("HttpOnly; Secure; SameSite=Lax");
});
```

- [ ] **Step 2: Run focused test with PostgreSQL fixture and verify RED because schema/store do not exist**

- [ ] **Step 3: Add Prisma models and migration**

```prisma
model OAuthTransientState {
  stateHash    String   @id
  codeVerifier String
  returnTo     String
  expiresAt    DateTime
  createdAt    DateTime @default(now())

  @@index([expiresAt])
}

model AuthSession {
  tokenHash String   @id
  userId    String
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
  @@index([expiresAt])
}
```

- [ ] **Step 4: Implement hashed one-time state consumption and hashed session resolution/revocation**

- [ ] **Step 5: Run `pnpm prisma validate`, focused tests, `pnpm typecheck`**

- [ ] **Step 6: Commit `feat: add persistent auth session storage`**

### Task 3: SSO controller and Next.js auth routes

**Files:**
- Create: `src/auth/bouquet-sso-controller.test.ts`
- Create: `src/auth/bouquet-sso-controller.ts`
- Create: `app/api/auth/bouquet/start/route.ts`
- Create: `app/api/auth/bouquet/callback/route.ts`
- Create: `app/api/auth/logout/route.ts`

**Interfaces:**
- Produces: `BouquetSsoController.start(returnTo?)`
- Produces: `BouquetSsoController.callback({code,state,cookieHeader})`
- Produces: `BouquetSsoController.logout(cookieHeader?)`

- [ ] **Step 1: Write failing state/open-redirect/callback/logout tests**

```ts
it("rejects protocol-relative returnTo", async () => {
  await expect(controller.start("//evil.example")).rejects.toThrow(/local path/);
});

it("rejects callback when browser state and query state differ", async () => {
  const response = await controller.callback({ code: "code", state: "server", cookieHeader: "dasigap_oauth_state=browser" });
  expect(response.status).toBe(400);
  expect(response.body).toEqual({ error: "INVALID_OAUTH_STATE" });
});
```

- [ ] **Step 2: Run focused controller test and verify RED**

- [ ] **Step 3: Implement controller using Task 1 OAuth client and Task 2 stores**

Route handlers translate controller responses to `NextResponse` and append each `Set-Cookie`; callback upstream failures return generic 502 `{ error: "BOUQUET_AUTH_FAILED" }`.

- [ ] **Step 4: Run focused tests and typecheck**

- [ ] **Step 5: Commit `feat: add bouquet sso route handlers`**

### Task 4: Connect production requireUser to local session

**Files:**
- Modify: `src/auth/server-auth.test.ts`
- Modify: `src/auth/server-auth.ts`
- Create: `src/auth/session-auth-adapter.ts`

**Interfaces:**
- Consumes: `AuthSessionStore.resolve(token)` and `sessionTokenFromCookie(request.headers.get("cookie"))`
- Preserves: `createRequireUser({ mode, nodeEnv, bouquetAdapter? })`
- Changes default `requireUser(request)` production bouquet path to use `PrismaAuthSessionStore`

- [ ] **Step 1: Add failing tests for valid/expired/missing local session behavior**

```ts
it("resolves bouquet mode through a dasigap session adapter", async () => {
  const bouquetAdapter: AuthAdapter = { async getCurrentUser() { return { userId: "bouquet-42" }; } };
  const requireUser = createRequireUser({ mode: "bouquet", nodeEnv: "production", bouquetAdapter });
  await expect(requireUser(new Request("https://dasigap.example/api/items"))).resolves.toEqual({ userId: "bouquet-42" });
});
```

Add adapter-specific tests proving missing/invalid cookie returns null and raw cookie content is not treated as userId.

- [ ] **Step 2: Run focused auth tests and verify RED for the new adapter**

- [ ] **Step 3: Implement `SessionAuthAdapter` and wire default bouquet mode with Prisma store**

- [ ] **Step 4: Run `pnpm vitest run src/auth`, then `pnpm test`, `pnpm typecheck`**

- [ ] **Step 5: Commit `feat: connect bouquet sessions to server auth`**

### Task 5: Production auth regression gate

**Files:**
- Create: `tests/e2e/bouquet-auth-boundary.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/release/mvp-checklist.md`

**Interfaces:**
- Produces a release regression contract proving production cannot silently use dev auth and auth callback/session cookies keep security attributes.

- [ ] **Step 1: Add failing integration/E2E assertions for production auth configuration and cookie semantics**

- [ ] **Step 2: Run the focused suite and verify RED where production integration is still missing**

- [ ] **Step 3: Add only the CI env/steps required for deterministic auth boundary tests; never commit real client secrets**

- [ ] **Step 4: Run full release commands**

```bash
pnpm install --frozen-lockfile
pnpm prisma validate
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

- [ ] **Step 5: Confirm forbidden-feature scan still passes and no OAuth token/state/session raw secret is logged or persisted**

- [ ] **Step 6: Commit `test: add production auth release gate`**

## Completion Gate

The branch is eligible for PR only when the fresh branch CI verifies Prisma migrations, typecheck, all unit/integration/security tests, production build and full E2E. Actual production rollout remains blocked until the Bouquet OAuth client for `dasigap` has the production callback URI registered and server-only configuration is provisioned.
