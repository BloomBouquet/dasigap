import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE as DELETE_DOCUMENT } from "../../app/api/documents/[id]/route";
import { GET as GET_SIGNED_URL } from "../../app/api/documents/[id]/signed-url/route";
import { POST as POST_DOCUMENT } from "../../app/api/items/[id]/documents/route";
import { DELETE as DELETE_ITEM } from "../../app/api/items/[id]/route";
import { prisma } from "../../src/db/prisma";
import { readPrivateObjectForTest } from "../../src/documents/storage";

const HEADER = "x-dasigap-dev-user";
const OWNER = "t7-owner";
const OTHER = "t7-other";

function request(url: string, init: RequestInit = {}, userId = OWNER) {
  const headers = new Headers(init.headers);
  headers.set(HEADER, userId);
  return new Request(url, { ...init, headers });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function createItem() {
  return prisma.item.create({
    data: {
      userId: OWNER,
      name: "MacBook Air",
      category: "노트북",
      purchaseDate: new Date("2026-08-20T00:00:00.000Z"),
      purchasePrice: 1490000,
    },
  });
}

function receiptForm(filename = "my-receipt.pdf") {
  const form = new FormData();
  form.set("type", "RECEIPT");
  form.set("file", new File(["private receipt bytes"], filename, { type: "application/pdf" }));
  return form;
}

describe("private document storage", () => {
  beforeEach(async () => {
    vi.stubEnv("AUTH_MODE", "dev");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OBJECT_STORAGE_MODE", "memory");
    vi.stubEnv("OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS", "300");
    await prisma.item.deleteMany({ where: { userId: { in: [OWNER, OTHER] } } });
  });

  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => prisma.$disconnect());

  it("uploads a validated receipt privately without exposing its storage key", async () => {
    const item = await createItem();
    const response = await POST_DOCUMENT(
      request(`http://localhost/api/items/${item.id}/documents`, {
        method: "POST",
        body: receiptForm(),
      }),
      context(item.id),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.document).toMatchObject({ itemId: item.id, type: "RECEIPT" });
    expect(body.document.storageKey).toBeUndefined();
    expect(body.document.url).toBeUndefined();

    const stored = await prisma.document.findUniqueOrThrow({ where: { id: body.document.id } });
    expect(stored.storageKey).toMatch(
      new RegExp(`^users/${OWNER}/items/${item.id}/documents/${body.document.id}/[0-9a-f-]+\\.pdf$`),
    );
    expect(stored.storageKey).not.toContain("my-receipt");
    await expect(readPrivateObjectForTest(stored.storageKey)).resolves.toEqual(
      Buffer.from("private receipt bytes"),
    );
  });

  it("returns a short-lived signed URL only to the document owner", async () => {
    const item = await createItem();
    const upload = await POST_DOCUMENT(
      request(`http://localhost/api/items/${item.id}/documents`, {
        method: "POST",
        body: receiptForm(),
      }),
      context(item.id),
    );
    const { document } = await upload.json();

    const ownerResponse = await GET_SIGNED_URL(
      request(`http://localhost/api/documents/${document.id}/signed-url`),
      context(document.id),
    );
    expect(ownerResponse.status).toBe(200);
    const ownerBody = await ownerResponse.json();
    expect(ownerBody).toMatchObject({ expiresIn: 300 });
    expect(ownerBody.url).toEqual(expect.any(String));
    expect(ownerBody.url).not.toContain("users/");

    const otherResponse = await GET_SIGNED_URL(
      request(`http://localhost/api/documents/${document.id}/signed-url`, {}, OTHER),
      context(document.id),
    );
    expect(otherResponse.status).toBe(404);
  });

  it("deletes the private object before deleting its database row", async () => {
    const item = await createItem();
    const upload = await POST_DOCUMENT(
      request(`http://localhost/api/items/${item.id}/documents`, {
        method: "POST",
        body: receiptForm(),
      }),
      context(item.id),
    );
    const { document } = await upload.json();
    const stored = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });

    const response = await DELETE_DOCUMENT(
      request(`http://localhost/api/documents/${document.id}`, { method: "DELETE" }),
      context(document.id),
    );
    expect(response.status).toBe(204);
    await expect(prisma.document.findUnique({ where: { id: document.id } })).resolves.toBeNull();
    await expect(readPrivateObjectForTest(stored.storageKey)).resolves.toBeNull();
  });

  it("removes private objects when deleting an owned item", async () => {
    const item = await createItem();
    const upload = await POST_DOCUMENT(
      request(`http://localhost/api/items/${item.id}/documents`, {
        method: "POST",
        body: receiptForm("item-delete-receipt.pdf"),
      }),
      context(item.id),
    );
    const { document } = await upload.json();
    const stored = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });

    const response = await DELETE_ITEM(
      request(`http://localhost/api/items/${item.id}`, { method: "DELETE" }),
      context(item.id),
    );

    expect(response.status).toBe(204);
    await expect(prisma.item.findUnique({ where: { id: item.id } })).resolves.toBeNull();
    await expect(readPrivateObjectForTest(stored.storageKey)).resolves.toBeNull();
  });

  it("rejects an unsafe upload before any document row is created", async () => {
    const item = await createItem();
    const form = new FormData();
    form.set("type", "RECEIPT");
    form.set("file", new File(["<svg></svg>"], "receipt.svg", { type: "image/svg+xml" }));

    const response = await POST_DOCUMENT(
      request(`http://localhost/api/items/${item.id}/documents`, { method: "POST", body: form }),
      context(item.id),
    );
    expect(response.status).toBe(400);
    await expect(prisma.document.count({ where: { itemId: item.id } })).resolves.toBe(0);
  });
});
