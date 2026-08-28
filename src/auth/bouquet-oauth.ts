import { createHash, randomBytes } from "node:crypto";

import { prisma } from "../db/prisma";

const FLOW_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export const BOUQUET_SESSION_COOKIE = "dasigap_session";

export class BouquetAuthError extends Error {
  constructor(message = "bouquet_auth_failed") {
    super(message);
    this.name = "BouquetAuthError";
  }
}

type BouquetConfig = {
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  sessionTtlSeconds: number;
};

function base64Url(bytes: Buffer) {
  return bytes.toString("base64url");
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readConfig(): BouquetConfig {
  const baseUrl = process.env.BOUQUET_AUTH_BASE_URL?.trim().replace(/\/+$/, "");
  const clientId = process.env.BOUQUET_AUTH_CLIENT_ID?.trim();
  const redirectUri = process.env.BOUQUET_AUTH_REDIRECT_URI?.trim();
  const sessionTtlSeconds = Number.parseInt(
    process.env.BOUQUET_SESSION_TTL_SECONDS ?? String(DEFAULT_SESSION_TTL_SECONDS),
    10,
  );

  if (!baseUrl) throw new BouquetAuthError("bouquet_base_url_missing");
  if (!clientId || !/^[A-Za-z0-9._-]{8,64}$/.test(clientId)) {
    throw new BouquetAuthError("bouquet_client_id_invalid");
  }
  if (!redirectUri) throw new BouquetAuthError("bouquet_redirect_uri_missing");

  let parsedBase: URL;
  let parsedRedirect: URL;
  try {
    parsedBase = new URL(baseUrl);
    parsedRedirect = new URL(redirectUri);
  } catch {
    throw new BouquetAuthError("bouquet_url_invalid");
  }

  const allowHttpBase = parsedBase.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsedBase.hostname);
  if (parsedBase.protocol !== "https:" && !allowHttpBase) {
    throw new BouquetAuthError("bouquet_base_url_insecure");
  }

  const allowHttpRedirect = parsedRedirect.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsedRedirect.hostname);
  if (parsedRedirect.protocol !== "https:" && !allowHttpRedirect) {
    throw new BouquetAuthError("bouquet_redirect_uri_insecure");
  }
  if (parsedRedirect.hash || parsedRedirect.username || parsedRedirect.password) {
    throw new BouquetAuthError("bouquet_redirect_uri_invalid");
  }
  if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds < 300 || sessionTtlSeconds > 30 * 24 * 60 * 60) {
    throw new BouquetAuthError("bouquet_session_ttl_invalid");
  }

  return { baseUrl, clientId, redirectUri, sessionTtlSeconds };
}

export function safeReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

export async function beginBouquetAuthorization(returnTo?: string | null) {
  const config = readConfig();
  const state = base64Url(randomBytes(32));
  const codeVerifier = base64Url(randomBytes(64));
  const codeChallenge = pkceChallenge(codeVerifier);
  const now = new Date();

  await prisma.$transaction([
    prisma.bouquetAuthFlow.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.bouquetAuthFlow.create({
      data: {
        stateHash: sha256Hex(state),
        codeVerifier,
        redirectUri: config.redirectUri,
        returnTo: safeReturnTo(returnTo),
        expiresAt: new Date(now.getTime() + FLOW_TTL_MS),
      },
    }),
  ]);

  const url = new URL("/bloom/", config.baseUrl);
  url.searchParams.set("mode", "auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url;
}

async function consumeFlow(state: string) {
  const stateHash = sha256Hex(state);
  const flow = await prisma.bouquetAuthFlow.findUnique({ where: { stateHash } });
  if (!flow || flow.expiresAt.getTime() <= Date.now()) {
    if (flow) await prisma.bouquetAuthFlow.deleteMany({ where: { id: flow.id } });
    return null;
  }

  try {
    await prisma.bouquetAuthFlow.delete({ where: { stateHash } });
  } catch {
    return null;
  }
  return flow;
}

async function providerJson(response: Response) {
  if (!response.ok) throw new BouquetAuthError("bouquet_provider_rejected");
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    throw new BouquetAuthError("bouquet_provider_invalid_response");
  }
}

export async function completeBouquetAuthorization(code: string | null, state: string | null) {
  if (!code || !state) throw new BouquetAuthError("bouquet_callback_invalid");
  const config = readConfig();
  const flow = await consumeFlow(state);
  if (!flow || flow.redirectUri !== config.redirectUri) {
    throw new BouquetAuthError("bouquet_state_invalid");
  }

  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: flow.redirectUri,
    code_verifier: flow.codeVerifier,
  });
  const tokenResponse = await fetch(`${config.baseUrl}/api/bouquet/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenBody,
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  });
  const tokenPayload = await providerJson(tokenResponse);
  const accessToken = typeof tokenPayload.access_token === "string" ? tokenPayload.access_token : "";
  if (!accessToken) throw new BouquetAuthError("bouquet_token_missing");

  const userResponse = await fetch(`${config.baseUrl}/api/bouquet/oauth/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  });
  const userPayload = await providerJson(userResponse);
  const userId = typeof userPayload.sub === "string" ? userPayload.sub.trim() : "";
  if (!userId || userId.length > 200) throw new BouquetAuthError("bouquet_user_invalid");

  const rawSession = base64Url(randomBytes(32));
  const expiresAt = new Date(Date.now() + config.sessionTtlSeconds * 1000);
  await prisma.$transaction([
    prisma.bouquetProjectSession.deleteMany({ where: { expiresAt: { lte: new Date() } } }),
    prisma.bouquetProjectSession.create({
      data: { tokenHash: sha256Hex(rawSession), userId, expiresAt },
    }),
  ]);

  return {
    userId,
    returnTo: flow.returnTo,
    rawSession,
    maxAgeSeconds: config.sessionTtlSeconds,
  };
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

export async function resolveBouquetProjectUser(request: Request) {
  const rawSession = cookieValue(request, BOUQUET_SESSION_COOKIE);
  if (!rawSession) return null;
  const tokenHash = sha256Hex(rawSession);
  const session = await prisma.bouquetProjectSession.findUnique({ where: { tokenHash } });
  if (!session || session.expiresAt.getTime() <= Date.now()) {
    if (session) await prisma.bouquetProjectSession.deleteMany({ where: { id: session.id } });
    return null;
  }
  return { userId: session.userId };
}

export async function revokeBouquetProjectSession(request: Request) {
  const rawSession = cookieValue(request, BOUQUET_SESSION_COOKIE);
  if (!rawSession) return;
  await prisma.bouquetProjectSession.deleteMany({ where: { tokenHash: sha256Hex(rawSession) } });
}

export function sessionCookie(value: string, maxAgeSeconds: number, nodeEnv = process.env.NODE_ENV ?? "production") {
  const parts = [
    `${BOUQUET_SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (nodeEnv === "production") parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(nodeEnv = process.env.NODE_ENV ?? "production") {
  return sessionCookie("", 0, nodeEnv);
}
