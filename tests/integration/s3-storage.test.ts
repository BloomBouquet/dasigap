import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  checkObjectStorageReadiness,
  createSignedReadUrl,
  deletePrivateObject,
  putPrivateObject,
} from "../../src/documents/storage";

const runS3 = process.env.RUN_S3_INTEGRATION === "1" ? describe : describe.skip;

runS3("S3-compatible private storage", () => {
  beforeAll(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OBJECT_STORAGE_ENDPOINT", process.env.OBJECT_STORAGE_ENDPOINT ?? "http://127.0.0.1:9000");
    vi.stubEnv("OBJECT_STORAGE_REGION", process.env.OBJECT_STORAGE_REGION ?? "us-east-1");
    vi.stubEnv("OBJECT_STORAGE_BUCKET", process.env.OBJECT_STORAGE_BUCKET ?? "dasigap-ci");
    vi.stubEnv("OBJECT_STORAGE_ACCESS_KEY_ID", process.env.OBJECT_STORAGE_ACCESS_KEY_ID ?? "dasigap-ci");
    vi.stubEnv("OBJECT_STORAGE_SECRET_ACCESS_KEY", process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ?? "dasigap-ci-secret");
  });

  afterAll(() => vi.unstubAllEnvs());

  it("proves the configured private bucket is reachable without mutation", async () => {
    await expect(checkObjectStorageReadiness({ timeoutMs: 2_000 })).resolves.toBe(true);
  });

  it("uploads privately, reads through a short-lived presigned URL, and deletes the object", async () => {
    const storageKey = `release-gate/${randomUUID()}/receipt.txt`;
    const bytes = Buffer.from("dasigap-s3-release-gate");

    await putPrivateObject({
      storageKey,
      bytes,
      contentType: "text/plain",
    });

    const signedUrl = await createSignedReadUrl(storageKey, 60);
    const parsed = new URL(signedUrl);
    expect(parsed.protocol).toBe("http:");
    expect(parsed.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(parsed.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);

    const read = await fetch(signedUrl);
    expect(read.status).toBe(200);
    expect(Buffer.from(await read.arrayBuffer())).toEqual(bytes);

    await deletePrivateObject(storageKey);

    const afterDelete = await fetch(signedUrl);
    expect(afterDelete.status).toBe(404);
  });
});
