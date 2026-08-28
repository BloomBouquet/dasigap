import { prisma } from "../db/prisma";
import {
  PrismaAuthSessionStore,
  PrismaTransientAuthStore,
} from "./auth-session";
import {
  BouquetOAuthClient,
  loadBouquetOAuthConfig,
  type BouquetFetch,
} from "./bouquet-oauth";
import { BouquetSsoController } from "./bouquet-sso-controller";

export function createConfiguredBouquetSsoController(
  env: Record<string, string | undefined> = process.env,
  fetcher: BouquetFetch = fetch,
): BouquetSsoController {
  const config = loadBouquetOAuthConfig(env);
  return new BouquetSsoController({
    config,
    oauth: new BouquetOAuthClient(config, fetcher),
    transient: new PrismaTransientAuthStore(prisma),
    sessions: new PrismaAuthSessionStore(prisma),
  });
}
