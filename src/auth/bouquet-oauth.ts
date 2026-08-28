import type { AuthenticatedUser } from "./types";

export interface BouquetOAuthConfig {
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  clientId: string;
  redirectUri: string;
  postLoginUrl: string;
  clientSecret?: string;
}

export type BouquetFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface BouquetTokenResult {
  accessToken: string;
  tokenType?: string;
}

function required(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new RangeError(`${name} is required`);
  }
  return value;
}

function absoluteUrl(
  value: string,
  name: string,
  nodeEnv: string,
): URL {
  try {
    const url = new URL(value);
    const localHost =
      url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const allowLocalHttp = nodeEnv !== "production" && localHost;
    if (url.protocol !== "https:" && !(allowLocalHttp && url.protocol === "http:")) {
      throw new Error("insecure protocol");
    }
    return url;
  } catch {
    throw new RangeError(`${name} must be a valid HTTPS URL`);
  }
}

function localPath(value: string, name: string): string {
  const normalized = value.trim();
  if (
    !normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    normalized.includes("\\") ||
    /[\r\n]/.test(normalized)
  ) {
    throw new RangeError(`${name} must be a local path`);
  }
  return normalized;
}

export function loadBouquetOAuthConfig(
  env: Record<string, string | undefined>,
): BouquetOAuthConfig {
  const nodeEnv = env.NODE_ENV?.trim() || "production";
  const baseUrl = absoluteUrl(
    required(env, "BOUQUET_AUTH_BASE_URL"),
    "BOUQUET_AUTH_BASE_URL",
    nodeEnv,
  );
  const redirectUri = absoluteUrl(
    required(env, "BOUQUET_AUTH_REDIRECT_URI"),
    "BOUQUET_AUTH_REDIRECT_URI",
    nodeEnv,
  ).toString();
  const clientId = required(env, "BOUQUET_AUTH_APP_ID");
  const postLoginUrl = localPath(
    env.DASIGAP_POST_LOGIN_URL?.trim() || "/",
    "DASIGAP_POST_LOGIN_URL",
  );
  const clientSecret = env.BOUQUET_AUTH_APP_SECRET?.trim();

  return {
    authorizationUrl: new URL("/authorize", baseUrl).toString(),
    tokenUrl: new URL("/token", baseUrl).toString(),
    userinfoUrl: new URL("/userinfo", baseUrl).toString(),
    clientId,
    redirectUri,
    postLoginUrl,
    ...(clientSecret ? { clientSecret } : {}),
  };
}

function base64Url(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const block = (a << 16) | (b << 8) | c;

    output += alphabet[(block >> 18) & 63];
    output += alphabet[(block >> 12) & 63];
    if (index + 1 < bytes.length) {
      output += alphabet[(block >> 6) & 63];
    }
    if (index + 2 < bytes.length) {
      output += alphabet[block & 63];
    }
  }

  return output.replace(/\+/g, "-").replace(/\//g, "_");
}

export async function createPkcePair(
  verifier?: string,
): Promise<{ verifier: string; challenge: string }> {
  const random = new Uint8Array(32);
  if (!verifier) {
    crypto.getRandomValues(random);
  }

  const actualVerifier = verifier ?? base64Url(random);
  if (actualVerifier.length < 43 || actualVerifier.length > 128) {
    throw new RangeError("PKCE verifier must be between 43 and 128 characters");
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(actualVerifier),
  );

  return {
    verifier: actualVerifier,
    challenge: base64Url(new Uint8Array(digest)),
  };
}

export function buildAuthorizationUrl(
  config: BouquetOAuthConfig,
  input: { state: string; codeChallenge: string },
): string {
  const state = input.state.trim();
  const codeChallenge = input.codeChallenge.trim();
  if (!state || !codeChallenge) {
    throw new RangeError("OAuth state and PKCE challenge are required");
  }

  const url = new URL(config.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function readJsonObject(
  response: Response,
): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new RangeError("Bouquet response must be valid JSON");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Bouquet response must be a JSON object");
  }

  return value as Record<string, unknown>;
}

export class BouquetOAuthClient {
  private readonly config: BouquetOAuthConfig;
  private readonly fetcher: BouquetFetch;

  constructor(config: BouquetOAuthConfig, fetcher: BouquetFetch = fetch) {
    this.config = config;
    this.fetcher = fetcher;
  }

  async exchangeCode(
    code: string,
    codeVerifier: string,
  ): Promise<BouquetTokenResult> {
    const normalizedCode = code.trim();
    const normalizedVerifier = codeVerifier.trim();
    if (!normalizedCode) {
      throw new RangeError("authorization code is required");
    }
    if (!normalizedVerifier) {
      throw new RangeError("PKCE verifier is required");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      code: normalizedCode,
      code_verifier: normalizedVerifier,
    });
    if (this.config.clientSecret) {
      body.set("client_secret", this.config.clientSecret);
    }

    const response = await this.fetcher(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) {
      throw new Error(`Bouquet token exchange failed (${response.status})`);
    }

    const json = await readJsonObject(response);
    const accessToken =
      typeof json.access_token === "string" ? json.access_token.trim() : "";
    if (!accessToken) {
      throw new RangeError("Bouquet token response requires access_token");
    }
    const tokenType =
      typeof json.token_type === "string" && json.token_type.trim()
        ? json.token_type.trim()
        : undefined;

    return {
      accessToken,
      ...(tokenType ? { tokenType } : {}),
    };
  }

  async fetchIdentity(accessToken: string): Promise<AuthenticatedUser> {
    const normalizedToken = accessToken.trim();
    if (!normalizedToken) {
      throw new RangeError("access token is required");
    }

    const response = await this.fetcher(this.config.userinfoUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${normalizedToken}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`Bouquet userinfo request failed (${response.status})`);
    }

    const json = await readJsonObject(response);
    const rawUserId =
      typeof json.userId === "string"
        ? json.userId
        : typeof json.sub === "string"
          ? json.sub
          : "";
    const userId = rawUserId.trim();
    if (!userId) {
      throw new RangeError("Bouquet userinfo requires a user id");
    }

    return { userId };
  }
}
