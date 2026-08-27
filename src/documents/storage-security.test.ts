import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ObjectStorageConfigurationError,
  putPrivateObject,
} from "./storage";

describe("private object storage production safety", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("never enables ephemeral memory storage in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OBJECT_STORAGE_MODE", "memory");
    vi.stubEnv("OBJECT_STORAGE_ENDPOINT", "");
    vi.stubEnv("OBJECT_STORAGE_REGION", "");
    vi.stubEnv("OBJECT_STORAGE_BUCKET", "");
    vi.stubEnv("OBJECT_STORAGE_ACCESS_KEY_ID", "");
    vi.stubEnv("OBJECT_STORAGE_SECRET_ACCESS_KEY", "");

    await expect(
      putPrivateObject({
        storageKey: "users/test/items/11111111-1111-4111-8111-111111111111/documents/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.pdf",
        bytes: Buffer.from("private"),
        contentType: "application/pdf",
      }),
    ).rejects.toBeInstanceOf(ObjectStorageConfigurationError);
  });
});
