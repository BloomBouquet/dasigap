import { describe, expect, it } from "vitest";

import {
  MAX_DOCUMENT_BYTES,
  buildPrivateStorageKey,
  validateDocumentUpload,
} from "./upload-policy";

const allowed = [
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
] as const;

describe("private document upload policy", () => {
  it.each(allowed)("allows %s and normalizes extension", (mimeType, extension) => {
    expect(validateDocumentUpload({ mimeType, size: 1024 })).toEqual({ extension });
  });

  it.each(["image/svg+xml", "text/html", "application/octet-stream", "application/x-msdownload"])(
    "rejects unsafe type %s",
    (mimeType) => {
      expect(() => validateDocumentUpload({ mimeType, size: 1024 })).toThrow(/지원하지 않는 파일 형식/);
    },
  );

  it("sets the V1 maximum to exactly 10 MiB", () => {
    expect(MAX_DOCUMENT_BYTES).toBe(10 * 1024 * 1024);
    expect(validateDocumentUpload({ mimeType: "application/pdf", size: MAX_DOCUMENT_BYTES })).toEqual({
      extension: "pdf",
    });
    expect(() =>
      validateDocumentUpload({ mimeType: "application/pdf", size: MAX_DOCUMENT_BYTES + 1 }),
    ).toThrow(/10 MiB/);
  });

  it("builds an opaque user/item/document scoped key without the original filename", () => {
    const key = buildPrivateStorageKey({
      userId: "user-a",
      itemId: "11111111-1111-4111-8111-111111111111",
      documentId: "22222222-2222-4222-8222-222222222222",
      extension: "pdf",
      randomUuid: "33333333-3333-4333-8333-333333333333",
    });

    expect(key).toBe(
      "users/user-a/items/11111111-1111-4111-8111-111111111111/documents/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.pdf",
    );
    expect(key).not.toContain("receipt");
  });
});
