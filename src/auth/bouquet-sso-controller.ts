import {
  buildSessionClearCookie,
  buildSessionCookie,
  sessionTokenFromCookie,
  type AuthSessionStore,
  type TransientAuthStore,
} from "./auth-session";
import {
  buildAuthorizationUrl,
  createPkcePair,
  type BouquetOAuthConfig,
  type BouquetTokenResult,
} from "./bouquet-oauth";
import type { AuthenticatedUser } from "./types";

export const DASIGAP_OAUTH_STATE_COOKIE = "dasigap_oauth_state";

export interface BouquetOAuthOperations {
  exchangeCode(code: string, codeVerifier: string): Promise<BouquetTokenResult>;
  fetchIdentity(accessToken: string): Promise<AuthenticatedUser>;
}

export interface SsoControllerResponse {
  status: number;
  headers: Record<string, string>;
  cookies?: string[];
  body?: unknown;
}

export interface BouquetSsoControllerDependencies {
  config: BouquetOAuthConfig;
  oauth: BouquetOAuthOperations;
  transient: TransientAuthStore;
  sessions: AuthSessionStore;
  createState?: () => string;
  createPkce?: () => Promise<{ verifier: string; challenge: string }>;
}

export class InvalidReturnToError extends RangeError {
  constructor() {
    super("returnTo must be a local path");
    this.name = "InvalidReturnToError";
  }
}

function localReturnTo(value: string | undefined, fallback: string): string {
  const normalized = value?.trim() || fallback;
  if (
    !normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    normalized.includes("\\") ||
    /[\r\n]/.test(normalized)
  ) {
    throw new InvalidReturnToError();
  }
  return normalized;
}

function cookieValue(
  cookieHeader: string | null | undefined,
  cookieName: string,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== cookieName) {
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

function cookieSecure(config: BouquetOAuthConfig): boolean {
  return new URL(config.redirectUri).protocol === "https:";
}

function buildOauthStateCookie(state: string, secure: boolean): string {
  return `${DASIGAP_OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}; Path=/api/auth/bouquet; HttpOnly${secure ? "; Secure" : ""}; SameSite=Lax; Max-Age=300`;
}

function buildOauthStateClearCookie(secure: boolean): string {
  return `${DASIGAP_OAUTH_STATE_COOKIE}=; Path=/api/auth/bouquet; HttpOnly${secure ? "; Secure" : ""}; SameSite=Lax; Max-Age=0`;
}

export class BouquetSsoController {
  private readonly dependencies: BouquetSsoControllerDependencies;

  constructor(dependencies: BouquetSsoControllerDependencies) {
    this.dependencies = dependencies;
  }

  async start(returnTo?: string): Promise<SsoControllerResponse> {
    const state = (
      this.dependencies.createState ?? (() => crypto.randomUUID())
    )().trim();
    if (!state) {
      throw new RangeError("OAuth state generator returned an empty value");
    }

    const pkce = await (
      this.dependencies.createPkce ?? (() => createPkcePair())
    )();
    const target = localReturnTo(returnTo, this.dependencies.config.postLoginUrl);
    await this.dependencies.transient.save(state, {
      codeVerifier: pkce.verifier,
      returnTo: target,
    });

    const secure = cookieSecure(this.dependencies.config);
    return {
      status: 302,
      headers: {
        Location: buildAuthorizationUrl(this.dependencies.config, {
          state,
          codeChallenge: pkce.challenge,
        }),
      },
      cookies: [buildOauthStateCookie(state, secure)],
    };
  }

  async callback(input: {
    code?: string;
    state?: string;
    cookieHeader?: string | null;
  }): Promise<SsoControllerResponse> {
    const code = input.code?.trim();
    const state = input.state?.trim();
    const secure = cookieSecure(this.dependencies.config);
    const clearStateCookie = buildOauthStateClearCookie(secure);

    if (!code || !state) {
      return {
        status: 400,
        headers: {},
        cookies: [clearStateCookie],
        body: { error: "INVALID_OAUTH_CALLBACK" },
      };
    }

    const browserState = cookieValue(
      input.cookieHeader,
      DASIGAP_OAUTH_STATE_COOKIE,
    );
    if (!browserState || browserState !== state) {
      return {
        status: 400,
        headers: {},
        cookies: [clearStateCookie],
        body: { error: "INVALID_OAUTH_STATE" },
      };
    }

    const transient = await this.dependencies.transient.consume(state);
    if (!transient) {
      return {
        status: 400,
        headers: {},
        cookies: [clearStateCookie],
        body: { error: "INVALID_OAUTH_STATE" },
      };
    }

    let identity: AuthenticatedUser;
    try {
      const token = await this.dependencies.oauth.exchangeCode(
        code,
        transient.codeVerifier,
      );
      identity = await this.dependencies.oauth.fetchIdentity(token.accessToken);
    } catch {
      return {
        status: 502,
        headers: {},
        cookies: [clearStateCookie],
        body: { error: "BOUQUET_AUTH_FAILED" },
      };
    }

    const sessionToken = await this.dependencies.sessions.create(identity);
    return {
      status: 302,
      headers: {
        Location: localReturnTo(
          transient.returnTo,
          this.dependencies.config.postLoginUrl,
        ),
      },
      cookies: [
        buildSessionCookie(sessionToken, { secure }),
        clearStateCookie,
      ],
    };
  }

  async logout(
    cookieHeader?: string | null,
  ): Promise<SsoControllerResponse> {
    const sessionToken = sessionTokenFromCookie(cookieHeader);
    if (sessionToken) {
      await this.dependencies.sessions.revoke(sessionToken);
    }

    const secure = cookieSecure(this.dependencies.config);
    return {
      status: 204,
      headers: {},
      cookies: [buildSessionClearCookie({ secure })],
    };
  }
}
