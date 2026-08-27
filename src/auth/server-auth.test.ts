import { describe, expect, it } from "vitest";

import {
  AuthConfigurationError,
  AuthenticationError,
  createRequireUser,
} from "./server-auth";
import type { AuthAdapter } from "./auth-adapter";

describe("server authentication boundary", () => {
  it("rejects an unauthenticated development request with 401 semantics", async () => {
    const requireUser = createRequireUser({ mode: "dev", nodeEnv: "development" });

    await expect(requireUser(new Request("https://dasigap.local/items"))).rejects.toMatchObject({
      name: "AuthenticationError",
      status: 401,
    });
  });

  it("returns one stable userId from the development auth header", async () => {
    const requireUser = createRequireUser({ mode: "dev", nodeEnv: "development" });
    const request = new Request("https://dasigap.local/items", {
      headers: { "x-dasigap-dev-user": " user-123 " },
    });

    await expect(requireUser(request)).resolves.toEqual({ userId: "user-123" });
  });

  it("does not accept userId from query or body as authentication", async () => {
    const requireUser = createRequireUser({ mode: "dev", nodeEnv: "development" });
    const request = new Request("https://dasigap.local/items?userId=attacker", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "attacker" }),
    });

    await expect(requireUser(request)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("disables development authentication in production", () => {
    expect(() => createRequireUser({ mode: "dev", nodeEnv: "production" })).toThrow(
      AuthConfigurationError,
    );
  });

  it("fails closed when bouquet authentication is not configured", () => {
    expect(() => createRequireUser({ mode: "bouquet", nodeEnv: "production" })).toThrow(
      AuthConfigurationError,
    );
  });

  it("delegates bouquet authentication through the adapter seam", async () => {
    const bouquetAdapter: AuthAdapter = {
      async getCurrentUser() {
        return { userId: "bouquet-user" };
      },
    };
    const requireUser = createRequireUser({
      mode: "bouquet",
      nodeEnv: "production",
      bouquetAdapter,
    });

    await expect(requireUser(new Request("https://dasigap.local/items"))).resolves.toEqual({
      userId: "bouquet-user",
    });
  });
});
