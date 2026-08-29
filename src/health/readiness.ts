import { prisma } from "../db/prisma";
import { checkObjectStorageReadiness } from "../documents/storage";

type Probe = (signal?: AbortSignal) => Promise<void> | void;

export type ReadinessOptions = {
  databaseProbe?: Probe;
  objectStorageProbe?: Probe;
  timeoutMs?: number;
};

async function defaultDatabaseProbe() {
  await prisma.$queryRaw`SELECT 1`;
}

async function runProbe(probe: Probe, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("readiness timeout"));
      }, timeoutMs);
    });

    await Promise.race([
      Promise.resolve().then(() => probe(controller.signal)),
      timeout,
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkReadiness(options: ReadinessOptions = {}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 1500;
  const databaseProbe = options.databaseProbe ?? defaultDatabaseProbe;
  const objectStorageProbe = options.objectStorageProbe ?? checkObjectStorageReadiness;

  const [databaseReady, objectStorageReady] = await Promise.all([
    runProbe(databaseProbe, timeoutMs),
    runProbe(objectStorageProbe, timeoutMs),
  ]);

  return databaseReady && objectStorageReady;
}
