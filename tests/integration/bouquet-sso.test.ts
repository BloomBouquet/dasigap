import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as callback } from "../../app/auth/bouquet/callback/route";
import { GET as start } from "../../app/auth/bouquet/start/route";
import { GET as session } from "../../app/auth/session/route";
import { POST as signOut } from "../../app/auth/sign-out/route";
import { pkceChallenge } from "../../src/auth/bouquet-oauth";
import { prisma } from "../../src/db/prisma";

let provider: Server;
let providerBaseUrl = "";
let expectedChallenge = "";

function requestBody(request: import("node:http").IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function oauthStateCookie(state: string) {
  return { cookie: `dasigap_oauth_state=${encodeURIComponent(state)}` };
}

beforeAll(async () => {
  provider = createServer(async (request, response) => {
    if (request.url === "/api/bouquet/oauth/token" && request.method === "POST") {
      const body = new URLSearchParams(await requestBody(request));
      if (
        body.get("grant_type") !== "authorization_code" ||
        body.get("client_id") !== "dasigap-app" ||
        body.get("redirect_uri") !== "https://dasigap.test/auth/bouquet/callback" ||
        body.get("code") !== "one-time-code" ||
        !body.get("code_verifier") ||
        pkceChallenge(body.get("code_verifier")!) !== expectedChallenge
      ) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ access_token: "central-access-token", token_type: "Bearer", expires_in: 900 }));
      return;
    }

    if (request.url === "/api/bouquet/oauth/userinfo" && request.method === "GET") {
      if (request.headers.authorization !== "Bearer central-access-token") {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_token" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ sub: "bouquet-user-123", email: "user@example.com", name: "꽃다발 사용자" }));
      return;
    }

    response.writeHead(404);
    response.end();
  });

  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("provider did not bind");
  providerBaseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  vi.stubEnv("AUTH_MODE", "bouquet");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("BOUQUET_AUTH_BASE_URL", providerBaseUrl);
  vi.stubEnv("BOUQUET_AUTH_CLIENT_ID", "dasigap-app");
  vi.stubEnv("BOUQUET_AUTH_REDIRECT_URI", "https://dasigap.test/auth/bouquet/callback");
  vi.stubEnv("BOUQUET_SESSION_TTL_SECONDS", "604800");
  await prisma.bouquetAuthFlow.deleteMany();
  await prisma.bouquetProjectSession.deleteMany();
  expectedChallenge = "";
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.bouquetAuthFlow.deleteMany();
  await prisma.bouquetProjectSession.deleteMany();
  await prisma.$disconnect();
  await new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
});

describe("Bouquet SSO", () => {
  it("starts Authorization Code + PKCE and binds state to an HttpOnly browser cookie", async () => {
    const response = await start(new Request("https://dasigap.test/auth/bouquet/start?returnTo=%2Fitems"));

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe(providerBaseUrl);
    expect(location.pathname).toBe("/bloom/");
    expect(location.searchParams.get("mode")).toBe("auth");
    expect(location.searchParams.get("client_id")).toBe("dasigap-app");
    expect(location.searchParams.get("redirect_uri")).toBe("https://dasigap.test/auth/bouquet/callback");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.search).not.toContain("code_verifier");

    const state = location.searchParams.get("state")!;
    const setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toContain(`dasigap_oauth_state=${encodeURIComponent(state)}`);
    expect(setCookie).toContain("Path=/auth/bouquet");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Max-Age=300");

    expectedChallenge = location.searchParams.get("code_challenge")!;
    const flows = await prisma.bouquetAuthFlow.findMany();
    expect(flows).toHaveLength(1);
    expect(flows[0].returnTo).toBe("/items");
    expect(flows[0].codeVerifier).not.toBe("");
    expect(flows[0].stateHash).not.toBe(state);
  });

  it("rejects a callback from a browser that does not own the OAuth state", async () => {
    const startResponse = await start(new Request("https://dasigap.test/auth/bouquet/start?returnTo=%2Fitems"));
    const authorizeUrl = new URL(startResponse.headers.get("location")!);
    const state = authorizeUrl.searchParams.get("state")!;
    expectedChallenge = authorizeUrl.searchParams.get("code_challenge")!;

    const callbackResponse = await callback(
      new Request(`https://dasigap.test/auth/bouquet/callback?code=one-time-code&state=${encodeURIComponent(state)}`, {
        headers: oauthStateCookie("different-browser-state"),
      }),
    );

    expect(callbackResponse.status).toBe(400);
    expect(callbackResponse.headers.get("set-cookie")).toContain("dasigap_oauth_state=");
    expect(callbackResponse.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await prisma.bouquetAuthFlow.count()).toBe(1);
    expect(await prisma.bouquetProjectSession.count()).toBe(0);
  });

  it("exchanges the one-time code server-side and creates a project HttpOnly session", async () => {
    const startResponse = await start(new Request("https://dasigap.test/auth/bouquet/start?returnTo=%2Fitems"));
    const authorizeUrl = new URL(startResponse.headers.get("location")!);
    const state = authorizeUrl.searchParams.get("state")!;
    expectedChallenge = authorizeUrl.searchParams.get("code_challenge")!;

    const callbackResponse = await callback(
      new Request(`https://dasigap.test/auth/bouquet/callback?code=one-time-code&state=${encodeURIComponent(state)}`, {
        headers: oauthStateCookie(state),
      }),
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toBe("https://dasigap.test/items");
    const setCookie = callbackResponse.headers.get("set-cookie")!;
    expect(setCookie).toContain("dasigap_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("dasigap_oauth_state=");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).not.toContain("central-access-token");

    expect(await prisma.bouquetAuthFlow.count()).toBe(0);
    expect(await prisma.bouquetProjectSession.count()).toBe(1);

    const cookie = setCookie.split(";", 1)[0];
    const sessionResponse = await session(new Request("https://dasigap.test/auth/session", { headers: { cookie } }));
    expect(sessionResponse.status).toBe(200);
    await expect(sessionResponse.json()).resolves.toEqual({ user: { userId: "bouquet-user-123" } });

    const replay = await callback(
      new Request(`https://dasigap.test/auth/bouquet/callback?code=one-time-code&state=${encodeURIComponent(state)}`, {
        headers: oauthStateCookie(state),
      }),
    );
    expect(replay.status).toBe(400);
  });

  it("uses the registered callback origin instead of a hostile request host", async () => {
    const startResponse = await start(new Request("https://dasigap.test/auth/bouquet/start?returnTo=%2Fitems"));
    const authorizeUrl = new URL(startResponse.headers.get("location")!);
    const state = authorizeUrl.searchParams.get("state")!;
    expectedChallenge = authorizeUrl.searchParams.get("code_challenge")!;

    const callbackResponse = await callback(
      new Request(`https://host-header-attacker.example/auth/bouquet/callback?code=one-time-code&state=${encodeURIComponent(state)}`, {
        headers: oauthStateCookie(state),
      }),
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toBe("https://dasigap.test/items");
  });

  it("invalidates the project session without logging out the central Bouquet session", async () => {
    const startResponse = await start(new Request("https://dasigap.test/auth/bouquet/start"));
    const authorizeUrl = new URL(startResponse.headers.get("location")!);
    const state = authorizeUrl.searchParams.get("state")!;
    expectedChallenge = authorizeUrl.searchParams.get("code_challenge")!;
    const callbackResponse = await callback(
      new Request(`https://dasigap.test/auth/bouquet/callback?code=one-time-code&state=${encodeURIComponent(state)}`, {
        headers: oauthStateCookie(state),
      }),
    );
    const cookie = callbackResponse.headers.get("set-cookie")!.split(";", 1)[0];

    const logoutResponse = await signOut(new Request("https://dasigap.test/auth/sign-out", { method: "POST", headers: { cookie } }));
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await prisma.bouquetProjectSession.count()).toBe(0);

    const afterLogout = await session(new Request("https://dasigap.test/auth/session", { headers: { cookie } }));
    await expect(afterLogout.json()).resolves.toEqual({ user: null });
  });

  it("rejects an external returnTo target", async () => {
    const response = await start(new Request("https://dasigap.test/auth/bouquet/start?returnTo=https%3A%2F%2Fevil.example%2Fsteal"));
    const location = new URL(response.headers.get("location")!);
    const state = location.searchParams.get("state")!;
    const flow = await prisma.bouquetAuthFlow.findFirstOrThrow();
    expect(state).toBeTruthy();
    expect(flow.returnTo).toBe("/");
  });
});
