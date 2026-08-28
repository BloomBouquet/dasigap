import { describe, expect, it } from "vitest";

import type { AuthSessionStore } from "./auth-session";
import { SessionAuthAdapter } from "./session-auth-adapter";

function createStore(): AuthSessionStore & { resolved: string[] } {
  const resolved: string[] = [];
  return {
    resolved,
    async create() {
      return "unused";
    },
    async resolve(token: string) {
      resolved.push(token);
      return token === "valid-session" ? { userId: "bouquet-user-7" } : null;
    },
    async revoke() {},
  };
}

describe("SessionAuthAdapter", () => {
  it("returns null when the Dasigap session cookie is missing", async () => {
    const store = createStore();
    const adapter = new SessionAuthAdapter(store);

    await expect(
      adapter.getCurrentUser(new Request("https://dasigap.example/api/items")),
    ).resolves.toBeNull();
    expect(store.resolved).toEqual([]);
  });

  it("resolves only the opaque Dasigap session token through the session store", async () => {
    const store = createStore();
    const adapter = new SessionAuthAdapter(store);
    const request = new Request("https://dasigap.example/api/items", {
      headers: {
        cookie: "other=x; dasigap_session=valid-session",
        "x-dasigap-dev-user": "attacker-user",
      },
    });

    await expect(adapter.getCurrentUser(request)).resolves.toEqual({
      userId: "bouquet-user-7",
    });
    expect(store.resolved).toEqual(["valid-session"]);
  });

  it("never treats a raw cookie value as a user id", async () => {
    const store = createStore();
    const adapter = new SessionAuthAdapter(store);
    const request = new Request("https://dasigap.example/api/items", {
      headers: { cookie: "dasigap_session=attacker-user-id" },
    });

    await expect(adapter.getCurrentUser(request)).resolves.toBeNull();
    expect(store.resolved).toEqual(["attacker-user-id"]);
  });
});
