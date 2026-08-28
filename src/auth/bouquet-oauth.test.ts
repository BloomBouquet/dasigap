import { describe, expect, it } from "vitest";

import {
  BouquetOAuthClient,
  buildAuthorizationUrl,
  createPkcePair,
  loadBouquetOAuthConfig,
} from "./bouquet-oauth";

const baseEnv = {
  NODE_ENV: "production",
  BOUQUET_AUTH_BASE_URL: "https://bloombouquet.https.gsmsv.site",
  BOUQUET_AUTH_APP_ID: "dasigap",
  BOUQUET_AUTH_REDIRECT_URI: "https://dasigap.example/api/auth/bouquet/callback",
  DASIGAP_POST_LOGIN_URL: "/",
};

describe("Bouquet OAuth protocol", () => {
  it("rejects insecure production bouquet base URLs", () => {
    expect(() =>
      loadBouquetOAuthConfig({
        ...baseEnv,
        BOUQUET_AUTH_BASE_URL: "http://example.com",
      }),
    ).toThrow(/HTTPS/);
  });

  it("allows localhost HTTP only outside production", () => {
    const config = loadBouquetOAuthConfig({
      ...baseEnv,
      NODE_ENV: "development",
      BOUQUET_AUTH_BASE_URL: "http://127.0.0.1:4000",
      BOUQUET_AUTH_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/bouquet/callback",
    });

    expect(config.authorizationUrl).toBe("http://127.0.0.1:4000/authorize");
  });

  it("rejects a protocol-relative post-login target", () => {
    expect(() =>
      loadBouquetOAuthConfig({
        ...baseEnv,
        DASIGAP_POST_LOGIN_URL: "//evil.example",
      }),
    ).toThrow(/local path/);
  });

  it("builds an S256 authorization request", async () => {
    const config = loadBouquetOAuthConfig(baseEnv);
    const { challenge } = await createPkcePair("a".repeat(43));
    const url = new URL(
      buildAuthorizationUrl(config, {
        state: "state-1",
        codeChallenge: challenge,
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://bloombouquet.https.gsmsv.site/authorize",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("dasigap");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://dasigap.example/api/auth/bouquet/callback",
    );
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("code_challenge")).toBe(challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("exchanges an authorization code with the PKCE verifier", async () => {
    const config = loadBouquetOAuthConfig({
      ...baseEnv,
      BOUQUET_AUTH_APP_SECRET: "server-secret",
    });
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const client = new BouquetOAuthClient(config, async (input, init) => {
      calls.push({ input: input.toString(), init });
      return Response.json({ access_token: "access-123", token_type: "Bearer" });
    });

    await expect(client.exchangeCode("code-123", "v".repeat(43))).resolves.toEqual({
      accessToken: "access-123",
      tokenType: "Bearer",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("https://bloombouquet.https.gsmsv.site/token");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    const body = new URLSearchParams(String(calls[0]?.init?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe("dasigap");
    expect(body.get("code")).toBe("code-123");
    expect(body.get("code_verifier")).toBe("v".repeat(43));
    expect(body.get("client_secret")).toBe("server-secret");
  });

  it("maps userinfo userId or sub into the stable Dasigap identity", async () => {
    const config = loadBouquetOAuthConfig(baseEnv);
    const responses = [Response.json({ userId: " bouquet-user " }), Response.json({ sub: "subject-2" })];
    const client = new BouquetOAuthClient(config, async () => responses.shift()!);

    await expect(client.fetchIdentity("token-1")).resolves.toEqual({ userId: "bouquet-user" });
    await expect(client.fetchIdentity("token-2")).resolves.toEqual({ userId: "subject-2" });
  });

  it("rejects userinfo responses without a stable user id", async () => {
    const config = loadBouquetOAuthConfig(baseEnv);
    const client = new BouquetOAuthClient(config, async () => Response.json({ name: "No Id" }));

    await expect(client.fetchIdentity("token")).rejects.toThrow(/user id/);
  });
});
