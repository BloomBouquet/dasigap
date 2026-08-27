import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../../src/db/prisma";
import { DELETE, GET as GET_ITEM, PATCH } from "../../app/api/items/[id]/route";
import { GET, POST } from "../../app/api/items/route";

const DEV_USER_HEADER = "x-dasigap-dev-user";

function request(
  url: string,
  init: RequestInit = {},
  userId: string | null = "user-a",
) {
  const headers = new Headers(init.headers);

  if (userId) {
    headers.set(DEV_USER_HEADER, userId);
  }

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Request(url, { ...init, headers });
}

const validItem = {
  name: "AirPods Pro",
  category: "Audio",
  brand: "Apple",
  modelName: "A3047",
  storeName: "Apple Store",
  purchasePrice: 249000,
  purchaseDate: "2026-08-20",
};

async function itemContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("item CRUD API", () => {
  beforeEach(async () => {
    process.env.AUTH_MODE = "dev";
    process.env.NODE_ENV = "test";
    await prisma.item.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates and lists only the authenticated user's items", async () => {
    const createdResponse = await POST(
      request("http://localhost/api/items", {
        method: "POST",
        body: JSON.stringify(validItem),
      }),
    );

    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created.item).toMatchObject({
      name: "AirPods Pro",
      userId: "user-a",
      purchasePrice: 249000,
    });

    await prisma.item.create({
      data: {
        userId: "user-b",
        name: "Private item",
        category: "Other",
        purchaseDate: new Date("2026-08-20T00:00:00.000Z"),
        purchasePrice: 1000,
      },
    });

    const listResponse = await GET(request("http://localhost/api/items"));
    expect(listResponse.status).toBe(200);
    const list = await listResponse.json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].id).toBe(created.item.id);
  });

  it("gets, patches, and deletes an owned item", async () => {
    const item = await prisma.item.create({
      data: {
        userId: "user-a",
        name: "Old name",
        category: "Audio",
        purchaseDate: new Date("2026-08-20T00:00:00.000Z"),
        purchasePrice: 249000,
      },
    });

    const getResponse = await GET_ITEM(
      request(`http://localhost/api/items/${item.id}`),
      await itemContext(item.id),
    );
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      item: { id: item.id, name: "Old name" },
    });

    const patchResponse = await PATCH(
      request(`http://localhost/api/items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "New name" }),
      }),
      await itemContext(item.id),
    );
    expect(patchResponse.status).toBe(200);
    await expect(patchResponse.json()).resolves.toMatchObject({
      item: { id: item.id, name: "New name" },
    });

    const deleteResponse = await DELETE(
      request(`http://localhost/api/items/${item.id}`, { method: "DELETE" }),
      await itemContext(item.id),
    );
    expect(deleteResponse.status).toBe(204);
    await expect(prisma.item.findUnique({ where: { id: item.id } })).resolves.toBeNull();
  });

  it("returns a stable validation error envelope with field errors", async () => {
    const response = await POST(
      request("http://localhost/api/items", {
        method: "POST",
        body: JSON.stringify({ ...validItem, name: "", purchasePrice: 0 }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
      },
    });
    expect(body.error.fields.name).toEqual(expect.any(String));
    expect(body.error.fields.purchasePrice).toEqual(expect.any(String));
    expect(body.error.stack).toBeUndefined();
  });

  it("returns the same 404 envelope for cross-user and missing item access", async () => {
    const item = await prisma.item.create({
      data: {
        userId: "user-a",
        name: "Private item",
        category: "Audio",
        purchaseDate: new Date("2026-08-20T00:00:00.000Z"),
        purchasePrice: 249000,
      },
    });

    const crossUser = await GET_ITEM(
      request(`http://localhost/api/items/${item.id}`, {}, "user-b"),
      await itemContext(item.id),
    );
    const missing = await GET_ITEM(
      request(
        "http://localhost/api/items/00000000-0000-4000-8000-000000000999",
        {},
        "user-b",
      ),
      await itemContext("00000000-0000-4000-8000-000000000999"),
    );

    expect(crossUser.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await crossUser.json()).toEqual(await missing.json());
  });

  it("returns 401 without an authenticated user", async () => {
    const response = await GET(request("http://localhost/api/items", {}, null));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
  });
});
