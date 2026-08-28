import type { PrismaClient } from "@prisma/client";

import type { AuthenticatedUser } from "./types";
import { hashOpaqueSecret } from "./opaque-secret-hash";

export interface TransientAuthRecord {
  codeVerifier: string;
  returnTo: string;
}

export interface TransientAuthStore {
  save(state: string, record: TransientAuthRecord): Promise<void>;
  consume(state: string): Promise<TransientAuthRecord | null>;
}

export interface AuthSessionStore {
  create(identity: AuthenticatedUser): Promise<string>;
  resolve(token: string): Promise<AuthenticatedUser | null>;
  revoke(token: string): Promise<void>;
}

export interface TransientAuthStoreOptions {
  now?: () => Date;
  ttlMs?: number;
}

export interface AuthSessionStoreOptions {
  now?: () => Date;
  ttlMs?: number;
  createToken?: () => string;
}

export class PrismaTransientAuthStore implements TransientAuthStore {
  private readonly prisma: PrismaClient;
  private readonly now: () => Date;
  private readonly ttlMs: number;

  constructor(prisma: PrismaClient, options: TransientAuthStoreOptions = {}) {
    this.prisma = prisma;
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new RangeError("ttlMs must be positive");
    }
  }

  async save(state: string, record: TransientAuthRecord): Promise<void> {
    const normalizedState = state.trim();
    const codeVerifier = record.codeVerifier.trim();
    if (!normalizedState) {
      throw new RangeError("state is required");
    }
    if (!codeVerifier) {
      throw new RangeError("codeVerifier is required");
    }

    const stateHash = await hashOpaqueSecret(normalizedState);
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.ttlMs);

    await this.prisma.$transaction([
      this.prisma.oAuthTransientState.upsert({
        where: { stateHash },
        create: {
          stateHash,
          codeVerifier,
          returnTo: record.returnTo,
          expiresAt,
        },
        update: {
          codeVerifier,
          returnTo: record.returnTo,
          expiresAt,
          createdAt: now,
        },
      }),
      this.prisma.oAuthTransientState.deleteMany({
        where: { expiresAt: { lte: now }, stateHash: { not: stateHash } },
      }),
    ]);
  }

  async consume(state: string): Promise<TransientAuthRecord | null> {
    const normalizedState = state.trim();
    if (!normalizedState) {
      return null;
    }

    const stateHash = await hashOpaqueSecret(normalizedState);
    const now = this.now();

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.oAuthTransientState.findUnique({
        where: { stateHash },
      });
      if (!row) {
        return null;
      }

      if (row.expiresAt <= now) {
        await tx.oAuthTransientState.deleteMany({ where: { stateHash } });
        return null;
      }

      const deleted = await tx.oAuthTransientState.deleteMany({
        where: { stateHash, expiresAt: { gt: now } },
      });
      if (deleted.count !== 1) {
        return null;
      }

      return {
        codeVerifier: row.codeVerifier,
        returnTo: row.returnTo,
      };
    });
  }
}

export class PrismaAuthSessionStore implements AuthSessionStore {
  private readonly prisma: PrismaClient;
  private readonly now: () => Date;
  private readonly ttlMs: number;
  private readonly createToken: () => string;

  constructor(prisma: PrismaClient, options: AuthSessionStoreOptions = {}) {
    this.prisma = prisma;
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
    this.createToken = options.createToken ?? (() => crypto.randomUUID());
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new RangeError("ttlMs must be positive");
    }
  }

  async create(identity: AuthenticatedUser): Promise<string> {
    const userId = identity.userId.trim();
    if (!userId) {
      throw new RangeError("session identity requires userId");
    }

    const token = this.createToken().trim();
    if (!token) {
      throw new RangeError("session token generator returned an empty token");
    }

    const tokenHash = await hashOpaqueSecret(token);
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.ttlMs);

    await this.prisma.$transaction([
      this.prisma.authSession.upsert({
        where: { tokenHash },
        create: { tokenHash, userId, expiresAt },
        update: { userId, expiresAt, createdAt: now },
      }),
      this.prisma.authSession.deleteMany({
        where: { expiresAt: { lte: now }, tokenHash: { not: tokenHash } },
      }),
    ]);

    return token;
  }

  async resolve(token: string): Promise<AuthenticatedUser | null> {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      return null;
    }

    const tokenHash = await hashOpaqueSecret(normalizedToken);
    const now = this.now();
    const row = await this.prisma.authSession.findUnique({
      where: { tokenHash },
    });

    if (!row) {
      return null;
    }
    if (row.expiresAt <= now) {
      await this.prisma.authSession.deleteMany({ where: { tokenHash } });
      return null;
    }

    return { userId: row.userId };
  }

  async revoke(token: string): Promise<void> {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      return;
    }

    const tokenHash = await hashOpaqueSecret(normalizedToken);
    await this.prisma.authSession.deleteMany({ where: { tokenHash } });
  }
}

export const DASIGAP_SESSION_COOKIE = "dasigap_session";

function safeCookieValue(value: string): string {
  if (!value.trim()) {
    throw new RangeError("session token is required");
  }
  return encodeURIComponent(value);
}

export function buildSessionCookie(
  token: string,
  options: { maxAgeSeconds?: number; secure?: boolean } = {},
): string {
  const maxAgeSeconds = options.maxAgeSeconds ?? 7 * 24 * 60 * 60;
  const secure = options.secure ?? true;
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new RangeError("maxAgeSeconds must be positive");
  }

  return `${DASIGAP_SESSION_COOKIE}=${safeCookieValue(token)}; Path=/; HttpOnly${secure ? "; Secure" : ""}; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function buildSessionClearCookie(
  options: { secure?: boolean } = {},
): string {
  const secure = options.secure ?? true;
  return `${DASIGAP_SESSION_COOKIE}=; Path=/; HttpOnly${secure ? "; Secure" : ""}; SameSite=Lax; Max-Age=0`;
}

export function sessionTokenFromCookie(
  cookieHeader: string | null | undefined,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== DASIGAP_SESSION_COOKIE) {
      continue;
    }
    const value = rawValue.join("=");
    if (!value) {
      return null;
    }
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }

  return null;
}
