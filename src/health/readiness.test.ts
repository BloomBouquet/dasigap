import { describe, expect, it } from "vitest";

import { checkReadiness } from "./readiness";

describe("dependency readiness", () => {
  it("is ready only when database and object storage probes both succeed", async () => {
    await expect(
      checkReadiness({
        databaseProbe: async () => {},
        objectStorageProbe: async () => {},
        timeoutMs: 50,
      }),
    ).resolves.toBe(true);
  });

  it("returns false when a database probe throws synchronously", async () => {
    await expect(
      checkReadiness({
        databaseProbe: () => {
          throw new Error("db secret detail");
        },
        objectStorageProbe: async () => {},
        timeoutMs: 50,
      }),
    ).resolves.toBe(false);
  });

  it("returns false when an object storage probe rejects", async () => {
    await expect(
      checkReadiness({
        databaseProbe: async () => {},
        objectStorageProbe: async () => {
          throw new Error("storage secret detail");
        },
        timeoutMs: 50,
      }),
    ).resolves.toBe(false);
  });

  it("returns false when either dependency exceeds the timeout", async () => {
    await expect(
      checkReadiness({
        databaseProbe: async () => new Promise<void>(() => {}),
        objectStorageProbe: async () => {},
        timeoutMs: 10,
      }),
    ).resolves.toBe(false);
  });
});
