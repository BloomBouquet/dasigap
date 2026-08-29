import { prisma } from "../db/prisma";
import { checkObjectStorageReadiness } from "../documents/storage";

export type ReadinessDependencies = {
  database: () => Promise<boolean>;
  storage: () => Promise<boolean>;
  timeoutMs: number;
};

async function databaseReady(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function boundedProbe(
  probe: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      Promise.resolve().then(probe).catch(() => false),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkReadiness(
  deps: ReadinessDependencies = {
    database: databaseReady,
    storage: () => checkObjectStorageReadiness({ timeoutMs: 2_000 }),
    timeoutMs: 2_500,
  },
): Promise<boolean> {
  const [database, storage] = await Promise.all([
    boundedProbe(deps.database, deps.timeoutMs),
    boundedProbe(deps.storage, deps.timeoutMs),
  ]);

  return database && storage;
}
