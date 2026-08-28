import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../db/prisma";
import { hashOpaqueSecret } from "./opaque-secret-hash";
import {
  DASIGAP_SESSION_COOKIE,
  PrismaAuthSessionStore,
  PrismaTransientAuthStore,
  buildSessionClearCookie,
  buildSessionCookie,
  sessionTokenFromCookie,
} from "./auth-session";

const SESSION_USER = "auth-session-test-user";

describe("persistent OAuth state and Dasigap session", () => {
  beforeEach(async () => {
    await prisma.oAuthTransientState.deleteMany();
    await prisma.authSession.deleteMany({ where: { userId: SESSION_USER } });
  });

  afterAll(async () => {
    await prisma.oAuthTransientState.deleteMany();
    await prisma.authSession.deleteMany({ where: { userId: SESSION_USER } });
    await prisma.$disconnect();
  });

  it("stores OAuth state by hash and consumes it only once", async () => {
    const store = new PrismaTransientAuthStore(prisma, {
      now: () => new Date("2026-08-28T13:00:00.000Z"),
    });

    await store.save("raw-oauth-state", {
      codeVerifier: "v".repeat(43),
      returnTo: "/items",
    });

    const stateHash = await hashOpaqueSecret("raw-oauth-state");
    const stored = await prisma.oAuthTransientState.findUnique({
      where: { stateHash },
    });
    expect(stored).toMatchObject({
      stateHash,
      codeVerifier: "v".repeat(43),
      returnTo: "/items",
    });
    expect(stored?.stateHash).not.toBe("raw-oauth-state");

    await expect(store.consume("raw-oauth-state")).resolves.toEqual({
      codeVerifier: "v".repeat(43),
      returnTo: "/items",
    });
    await expect(store.consume("raw-oauth-state")).resolves.toBeNull();
  });

  it("rejects an expired OAuth state and removes it", async () => {
    const saveStore = new PrismaTransientAuthStore(prisma, {
      now: () => new Date("2026-08-28T13:00:00.000Z"),
      ttlMs: 60_000,
    });
    await saveStore.save("expired-state", {
      codeVerifier: "v".repeat(43),
      returnTo: "/",
    });

    const consumeStore = new PrismaTransientAuthStore(prisma, {
      now: () => new Date("2026-08-28T13:02:00.000Z"),
      ttlMs: 60_000,
    });
    await expect(consumeStore.consume("expired-state")).resolves.toBeNull();
    await expect(
      prisma.oAuthTransientState.findUnique({
        where: { stateHash: await hashOpaqueSecret("expired-state") },
      }),
    ).resolves.toBeNull();
  });

  it("never persists the raw Dasigap session token", async () => {
    const store = new PrismaAuthSessionStore(prisma, {
      now: () => new Date("2026-08-28T13:00:00.000Z"),
      createToken: () => "raw-session-token",
    });

    await expect(store.create({ userId: SESSION_USER })).resolves.toBe(
      "raw-session-token",
    );

    const tokenHash = await hashOpaqueSecret("raw-session-token");
    const stored = await prisma.authSession.findUnique({ where: { tokenHash } });
    expect(stored).toMatchObject({ tokenHash, userId: SESSION_USER });
    expect(stored?.tokenHash).not.toBe("raw-session-token");
    await expect(store.resolve("raw-session-token")).resolves.toEqual({
      userId: SESSION_USER,
    });
  });

  it("expires and revokes sessions", async () => {
    const token = "revocable-session";
    const store = new PrismaAuthSessionStore(prisma, {
      now: () => new Date("2026-08-28T13:00:00.000Z"),
      createToken: () => token,
      ttlMs: 60_000,
    });
    await store.create({ userId: SESSION_USER });
    await store.revoke(token);
    await expect(store.resolve(token)).resolves.toBeNull();

    const expiredToken = "expired-session";
    const saveStore = new PrismaAuthSessionStore(prisma, {
      now: () => new Date("2026-08-28T13:00:00.000Z"),
      createToken: () => expiredToken,
      ttlMs: 60_000,
    });
    await saveStore.create({ userId: SESSION_USER });
    const expiredStore = new PrismaAuthSessionStore(prisma, {
      now: () => new Date("2026-08-28T13:02:00.000Z"),
    });
    await expect(expiredStore.resolve(expiredToken)).resolves.toBeNull();
  });

  it("builds and parses an HttpOnly SameSite session cookie", () => {
    const cookie = buildSessionCookie("token value", { secure: true });
    expect(cookie).toContain(`${DASIGAP_SESSION_COOKIE}=token%20value`);
    expect(cookie).toContain("Path=/; HttpOnly; Secure; SameSite=Lax");
    expect(sessionTokenFromCookie(cookie)).toBe("token value");

    const clearCookie = buildSessionClearCookie({ secure: true });
    expect(clearCookie).toContain(`${DASIGAP_SESSION_COOKIE}=`);
    expect(clearCookie).toContain("Max-Age=0");
  });

  it("does not accept malformed or missing session cookies", () => {
    expect(sessionTokenFromCookie(undefined)).toBeNull();
    expect(sessionTokenFromCookie("other=value")).toBeNull();
    expect(sessionTokenFromCookie(`${DASIGAP_SESSION_COOKIE}=%E0%A4%A`)).toBeNull();
  });
});
