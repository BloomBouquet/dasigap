import { describe, expect, it, vi } from "vitest";

import { checkReadiness } from "./readiness";

describe("checkReadiness", () => {
  it("requires both dependencies", async () => {
    const database = vi.fn().mockResolvedValue(true);
    const storage = vi.fn().mockResolvedValue(true);

    await expect(checkReadiness({ database, storage, timeoutMs: 100 })).resolves.toBe(true);
    await expect(
      checkReadiness({
        database: vi.fn().mockResolvedValue(false),
        storage,
        timeoutMs: 100,
      }),
    ).resolves.toBe(false);
  });

  it("fails closed on timeout", async () => {
    const never = () => new Promise<boolean>(() => undefined);

    await expect(
      checkReadiness({ database: never, storage: never, timeoutMs: 10 }),
    ).resolves.toBe(false);
  });
});
