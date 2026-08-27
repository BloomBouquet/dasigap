import { randomUUID } from "node:crypto";
import { z } from "zod";

import { throwOwnedItemNotFound } from "../db/ownership";
import { prisma } from "../db/prisma";
import { deleteOwnedItem, getOwnedItem } from "../items/repository";
import {
  createSignedReadUrl,
  deletePrivateObject,
  putPrivateObject,
} from "./storage";
import {
  buildPrivateStorageKey,
  validateDocumentUpload,
} from "./upload-policy";

const documentTypeSchema = z.enum(["RECEIPT", "WARRANTY", "OTHER"]);

export class InvalidDocumentFormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDocumentFormError";
  }
}

function publicDocument(document: {
  id: string;
  itemId: string;
  type: "RECEIPT" | "WARRANTY" | "OTHER";
  createdAt: Date;
}) {
  return {
    id: document.id,
    itemId: document.itemId,
    type: document.type,
    createdAt: document.createdAt,
  };
}

export async function listOwnedDocuments(userId: string, itemId: string) {
  await getOwnedItem(userId, itemId);
  const documents = await prisma.document.findMany({
    where: { itemId },
    orderBy: { createdAt: "desc" },
    select: { id: true, itemId: true, type: true, createdAt: true },
  });
  return documents.map(publicDocument);
}

export async function uploadOwnedDocument(input: {
  userId: string;
  itemId: string;
  type: unknown;
  file: unknown;
}) {
  await getOwnedItem(input.userId, input.itemId);
  const type = documentTypeSchema.parse(input.type);
  if (!(input.file instanceof File)) {
    throw new InvalidDocumentFormError("업로드할 파일이 필요합니다.");
  }

  const { extension } = validateDocumentUpload({
    mimeType: input.file.type,
    size: input.file.size,
  });
  const documentId = randomUUID();
  const storageKey = buildPrivateStorageKey({
    userId: input.userId,
    itemId: input.itemId,
    documentId,
    randomUuid: randomUUID(),
    extension,
  });
  const bytes = new Uint8Array(await input.file.arrayBuffer());

  await putPrivateObject({ storageKey, bytes, contentType: input.file.type });
  try {
    const document = await prisma.document.create({
      data: {
        id: documentId,
        itemId: input.itemId,
        type,
        storageKey,
      },
      select: { id: true, itemId: true, type: true, createdAt: true },
    });
    return publicDocument(document);
  } catch (error) {
    try {
      await deletePrivateObject(storageKey);
    } catch {
      // Preserve the original database error. Storage cleanup can be retried operationally.
    }
    throw error;
  }
}

async function getOwnedDocument(userId: string, documentId: string) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, item: { userId } },
  });
  if (!document) throwOwnedItemNotFound();
  return document;
}

export function signedUrlTtlSeconds() {
  const raw = process.env.OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS ?? "300";
  const ttl = Number(raw);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 3600) return 300;
  return ttl;
}

export async function getOwnedDocumentSignedUrl(userId: string, documentId: string) {
  const document = await getOwnedDocument(userId, documentId);
  const expiresIn = signedUrlTtlSeconds();
  const url = await createSignedReadUrl(document.storageKey, expiresIn);
  return { url, expiresIn };
}

export async function deleteOwnedDocument(userId: string, documentId: string) {
  const document = await getOwnedDocument(userId, documentId);

  await deletePrivateObject(document.storageKey);
  const deleted = await prisma.document.deleteMany({
    where: { id: document.id, item: { userId } },
  });
  if (deleted.count !== 1) throwOwnedItemNotFound();
}

export async function deleteOwnedItemAndPrivateDocuments(userId: string, itemId: string) {
  await getOwnedItem(userId, itemId);

  const documents = await prisma.document.findMany({
    where: { itemId },
    select: { storageKey: true },
  });

  for (const document of documents) {
    await deletePrivateObject(document.storageKey);
  }

  await deleteOwnedItem(userId, itemId);
}
