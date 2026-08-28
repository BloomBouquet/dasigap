import type { AuthAdapter } from "./auth-adapter";
import { PrismaAuthSessionStore } from "./auth-session";
import { DevAuthAdapter } from "./dev-auth-adapter";
import { SessionAuthAdapter } from "./session-auth-adapter";
import type { AuthenticatedUser } from "./types";
import { prisma } from "../db/prisma";

export class AuthenticationError extends Error {
  readonly status = 401;

  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

export type AuthMode = "dev" | "bouquet";

export type ServerAuthConfig = {
  mode: AuthMode;
  nodeEnv: string;
  bouquetAdapter?: AuthAdapter;
};

export type RequireUser = (request: Request) => Promise<AuthenticatedUser>;

function resolveAdapter(config: ServerAuthConfig): AuthAdapter {
  if (config.mode === "dev") {
    if (config.nodeEnv === "production") {
      throw new AuthConfigurationError(
        "Development authentication cannot be enabled in production",
      );
    }

    return new DevAuthAdapter();
  }

  if (!config.bouquetAdapter) {
    throw new AuthConfigurationError(
      "Bouquet authentication adapter is not configured",
    );
  }

  return config.bouquetAdapter;
}

export function createRequireUser(config: ServerAuthConfig): RequireUser {
  const adapter = resolveAdapter(config);

  return async (request: Request): Promise<AuthenticatedUser> => {
    const user = await adapter.getCurrentUser(request);

    if (!user) {
      throw new AuthenticationError();
    }

    return user;
  };
}

function resolveAuthMode(value: string | undefined): AuthMode {
  if (value === "dev" || value === "bouquet") {
    return value;
  }

  if (value === undefined || value.trim() === "") {
    return "bouquet";
  }

  throw new AuthConfigurationError(`Unsupported AUTH_MODE: ${value}`);
}

function defaultBouquetAdapter(mode: AuthMode): AuthAdapter | undefined {
  if (mode !== "bouquet") {
    return undefined;
  }

  return new SessionAuthAdapter(new PrismaAuthSessionStore(prisma));
}

export async function requireUser(request: Request): Promise<AuthenticatedUser> {
  const mode = resolveAuthMode(process.env.AUTH_MODE);
  const requireConfiguredUser = createRequireUser({
    mode,
    nodeEnv: process.env.NODE_ENV ?? "production",
    bouquetAdapter: defaultBouquetAdapter(mode),
  });

  return requireConfiguredUser(request);
}
