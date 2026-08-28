import { describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "./types";
import type { AuthSessionStore, TransientAuthRecord, TransientAuthStore } from "./auth-session";
import type { BouquetOAuthConfig, BouquetTokenResult } from "./bouquet-oauth";
import {
  BouquetSsoController,
  DASIGAP_OAUTH_STATE_COOKIE,
} from "./bouquet-sso-controller";

class MemoryTransientStore implements TransientAuthStore {
  readonly records = new Map<string, TransientAuthRecord>();

  async save(state: string, record: TransientAuthRecord) {
    this.records.set(state, structuredClone(record));
  }

  async consume(state: string) {
    const record = this.records.get(state) ?? null;
    this.records.delete(state);
    return record ? structuredClone(record) : null;
  }
}

class MemorySessionStore implements AuthSessionStore {
  readonly sessions = new Map<string, AuthenticatedUser>();
  readonly revoked: string[] = [];

  async create(identity: AuthenticatedUser) {
    const token = "session-created";
    this.sessions.set(token, structuredClone(identity));
    return token;
  }

  async resolve(token: string) {
    return this.sessions.get(token) ?? null;
  }

  async revoke(token: string) {
    this.revoked.push(token);
    this.sessions.delete(token);
  }
}

const config: BouquetOAuthConfig = {
  authorizationUrl: "https://bouquet.example/authorize",
  tokenUrl: "https://bouquet.example/token",
  userinfoUrl: "https://bouquet.example/userinfo",
  clientId: "dasigap",
  redirectUri: "https://dasigap.example/api/auth/bouquet/callback",
  postLoginUrl: "/",
};

function createController() {
  const transient = new MemoryTransientStore();
  const sessions = new MemorySessionStore();
  const calls: string[] = [];
  const oauth = {
    async exchangeCode(code: string, verifier: string): Promise<BouquetTokenResult> {
      calls.push(`exchange:${code}:${verifier}`);
      return { accessToken: "bouquet-access" };
    },
    async fetchIdentity(token: string): Promise<AuthenticatedUser> {
      calls.push(`userinfo:${token}`);
      return { userId: "bouquet-user-42" };
    },
  };
  const controller = new BouquetSsoController({
    config,
    oauth,
    transient,
    sessions,
    createState: () => "state-fixed",
    createPkce: async () => ({
      verifier: "v".repeat(43),
      challenge: "challenge-fixed",
    }),
  });

  return { controller, transient, sessions, calls };
}

describe("Bouquet SSO controller", () => {
  it("starts OAuth with PKCE and stores a one-time local return target", async () => {
    const { controller, transient } = createController();

    const response = await controller.start("/items/123");
    const location = new URL(response.headers.Location);

    expect(response.status).toBe(302);
    expect(location.searchParams.get("state")).toBe("state-fixed");
    expect(location.searchParams.get("code_challenge")).toBe("challenge-fixed");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(transient.records.get("state-fixed")).toEqual({
      codeVerifier: "v".repeat(43),
      returnTo: "/items/123",
    });
    expect(response.cookies?.[0]).toContain(
      `${DASIGAP_OAUTH_STATE_COOKIE}=state-fixed`,
    );
    expect(response.cookies?.[0]).toContain("HttpOnly; Secure; SameSite=Lax; Max-Age=300");
  });

  it("rejects external or protocol-relative return targets", async () => {
    const { controller } = createController();

    await expect(controller.start("//evil.example")).rejects.toThrow(/local path/);
    await expect(controller.start("https://evil.example")).rejects.toThrow(/local path/);
  });

  it("rejects callback when browser state and query state differ", async () => {
    const { controller } = createController();
    const response = await controller.callback({
      code: "code-1",
      state: "server-state",
      cookieHeader: `${DASIGAP_OAUTH_STATE_COOKIE}=browser-state`,
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "INVALID_OAUTH_STATE" });
    expect(response.cookies?.[0]).toContain("Max-Age=0");
  });

  it("exchanges a valid one-time callback for a local Dasigap session", async () => {
    const { controller, sessions, calls } = createController();
    await controller.start("/reports");

    const response = await controller.callback({
      code: "code-1",
      state: "state-fixed",
      cookieHeader: `${DASIGAP_OAUTH_STATE_COOKIE}=state-fixed`,
    });

    expect(response.status).toBe(302);
    expect(response.headers.Location).toBe("/reports");
    expect(calls).toEqual([
      `exchange:code-1:${"v".repeat(43)}`,
      "userinfo:bouquet-access",
    ]);
    expect(sessions.sessions.get("session-created")).toEqual({
      userId: "bouquet-user-42",
    });
    expect(response.cookies?.join("\n")).toContain("dasigap_session=session-created");
    expect(response.cookies?.join("\n")).toContain(`${DASIGAP_OAUTH_STATE_COOKIE}=`);

    const replay = await controller.callback({
      code: "code-2",
      state: "state-fixed",
      cookieHeader: `${DASIGAP_OAUTH_STATE_COOKIE}=state-fixed`,
    });
    expect(replay).toMatchObject({
      status: 400,
      body: { error: "INVALID_OAUTH_STATE" },
    });
  });

  it("returns a generic 502 when Bouquet token or userinfo exchange fails", async () => {
    const transient = new MemoryTransientStore();
    const sessions = new MemorySessionStore();
    const controller = new BouquetSsoController({
      config,
      transient,
      sessions,
      oauth: {
        async exchangeCode() {
          throw new Error("upstream body with secret token");
        },
        async fetchIdentity() {
          throw new Error("unreachable");
        },
      },
      createState: () => "state-fixed",
      createPkce: async () => ({ verifier: "v".repeat(43), challenge: "challenge" }),
    });
    await controller.start("/");

    const response = await controller.callback({
      code: "code-secret",
      state: "state-fixed",
      cookieHeader: `${DASIGAP_OAUTH_STATE_COOKIE}=state-fixed`,
    });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: "BOUQUET_AUTH_FAILED" });
    expect(JSON.stringify(response)).not.toContain("secret token");
    expect(JSON.stringify(response)).not.toContain("code-secret");
  });

  it("revokes the local session and clears its cookie on logout", async () => {
    const { controller, sessions } = createController();
    sessions.sessions.set("logout-token", { userId: "bouquet-user-42" });

    const response = await controller.logout("dasigap_session=logout-token");

    expect(response.status).toBe(204);
    expect(sessions.revoked).toEqual(["logout-token"]);
    expect(response.cookies?.[0]).toContain("dasigap_session=");
    expect(response.cookies?.[0]).toContain("Max-Age=0");
  });
});
