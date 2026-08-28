import { expect, test } from "@playwright/test";

test.describe("Bouquet authentication HTTP boundary", () => {
  test("starts Authorization Code + PKCE without exposing server auth material", async ({ request }) => {
    const response = await request.get(
      "/api/auth/bouquet/start?returnTo=%2Freports",
      { maxRedirects: 0 },
    );

    expect(response.status()).toBe(302);
    const location = new URL(response.headers()["location"] ?? "");
    expect(location.origin + location.pathname).toBe(
      "http://127.0.0.1:3999/authorize",
    );
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("client_id")).toBe("dasigap");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:3000/api/auth/bouquet/callback",
    );
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(location.searchParams.get("code_challenge")).toBeTruthy();
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.has("code_verifier")).toBe(false);
    expect(location.searchParams.has("client_secret")).toBe(false);

    const cookie = response.headers()["set-cookie"] ?? "";
    expect(cookie).toContain("dasigap_oauth_state=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=300");
  });

  test("rejects an external return target before redirecting", async ({ request }) => {
    const response = await request.get(
      "/api/auth/bouquet/start?returnTo=%2F%2Fevil.example",
      { maxRedirects: 0 },
    );

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "INVALID_RETURN_TO" });
    expect(response.headers()["location"]).toBeUndefined();
  });

  test("rejects callback state mismatch without contacting Bouquet", async ({ request }) => {
    const response = await request.get(
      "/api/auth/bouquet/callback?code=code-secret&state=server-state",
      {
        headers: { cookie: "dasigap_oauth_state=browser-state" },
        maxRedirects: 0,
      },
    );

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "INVALID_OAUTH_STATE" });
    const body = await response.text();
    expect(body).not.toContain("code-secret");
    expect(response.headers()["set-cookie"] ?? "").toContain("Max-Age=0");
  });

  test("logout is idempotent and clears the local opaque session cookie", async ({ request }) => {
    const response = await request.post("/api/auth/logout", {
      headers: { cookie: "dasigap_session=unknown-session" },
    });

    expect(response.status()).toBe(204);
    expect(response.headers()["set-cookie"] ?? "").toContain("dasigap_session=");
    expect(response.headers()["set-cookie"] ?? "").toContain("HttpOnly");
    expect(response.headers()["set-cookie"] ?? "").toContain("SameSite=Lax");
    expect(response.headers()["set-cookie"] ?? "").toContain("Max-Age=0");
  });
});
