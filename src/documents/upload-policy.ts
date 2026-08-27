const MIME_EXTENSIONS = new Map<string, "jpg" | "png" | "webp" | "pdf">([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXTENSION = /^(jpg|png|webp|pdf)$/;

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export class DocumentUploadPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentUploadPolicyError";
  }
}

export function validateDocumentUpload(input: { mimeType: string; size: number }) {
  const extension = MIME_EXTENSIONS.get(input.mimeType.toLowerCase());
  if (!extension) {
    throw new DocumentUploadPolicyError("지원하지 않는 파일 형식입니다.");
  }
  if (!Number.isSafeInteger(input.size) || input.size < 1) {
    throw new DocumentUploadPolicyError("비어 있거나 올바르지 않은 파일입니다.");
  }
  if (input.size > MAX_DOCUMENT_BYTES) {
    throw new DocumentUploadPolicyError("문서 한 개는 최대 10 MiB까지 업로드할 수 있습니다.");
  }
  return { extension } as const;
}

export function buildPrivateStorageKey(input: {
  userId: string;
  itemId: string;
  documentId: string;
  extension: string;
  randomUuid: string;
}) {
  if (!input.userId.trim()) throw new DocumentUploadPolicyError("Invalid user id");
  if (!UUID.test(input.itemId) || !UUID.test(input.documentId) || !UUID.test(input.randomUuid)) {
    throw new DocumentUploadPolicyError("Invalid storage identifier");
  }
  if (!EXTENSION.test(input.extension)) throw new DocumentUploadPolicyError("Invalid extension");

  return `users/${encodeURIComponent(input.userId)}/items/${input.itemId}/documents/${input.documentId}/${input.randomUuid}.${input.extension}`;
}
