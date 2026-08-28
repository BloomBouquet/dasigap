import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, PATCH } from "../../app/api/items/[id]/resale/route";
import { prisma } from "../../src/db/prisma";

const DEV_USER_HEADER = "x-dasigap-dev-user";
const USER_A = "resale-user-a";
const USER_B = "resale-user-b";
const USERS = [USER_A, USER_B];
const SECRET_STORAGE_KEY = "users/private/items/secret/documents/receipt-secret.pdf";

function request(url: string, init: RequestInit = {}, userId: string | null = USER_A) {
  const headers = new Headers(init.headers);
  if (userId) headers.set(DEV_USER_HEADER, userId);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(url, { ...init, headers });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function createRichItem(userId = USER_A) {
  return prisma.item.create({
    data: {
      userId,
      name: "AirPods Pro",
      category: "Audio",
      modelName: "A3047",
      purchaseDate: new Date("2026-01-15T00:00:00.000Z"),
      purchasePrice: 249000,
      status: "OWNED",
      components: {
        create: [
          { name: "본체", isPresent: true },
          { name: "케이블", isPresent: true },
          { name: "박스", isPresent: false },
        ],
      },
      maintenance: {
        create: {
          type: "REPAIR",
          occurredAt: new Date("2026-05-01T00:00:00.000Z"),
          note: "이어팁 교체",
        },
      },
      documents: {
        create: {
          type: "RECEIPT",
          storageKey: SECRET_STORAGE_KEY,
        },
      },
    },
  });
}

describe("resale preparation API", () => {
  beforeEach(async () => {
    vi.stubEnv("AUTH_MODE", "dev");
    vi.stubEnv("NODE_ENV", "test");
    await prisma.item.deleteMany({ where: { userId: { in: USERS } } });
  });

  afterEach(() => vi.unstubAllEnvs());

  afterAll(async () => {
    await prisma.item.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.$disconnect();
  });

  it("persists a privacy-safe draft and marks the item SELL_PREPARING", async () => {
    const item = await createRichItem();

    const response = await PATCH(
      request(`http://localhost/api/items/${item.id}/resale`, {
        method: "PATCH",
        body: JSON.stringify({
          conditionGrade: "GOOD",
          defectNote: "작은 생활 흠집",
          askingPrice: 170000,
          photoChecklist: {
            front: true,
            back: true,
            detail: false,
            components: true,
          },
        }),
      }),
      context(item.id),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.draft).toMatchObject({
      itemId: item.id,
      conditionGrade: "GOOD",
      defectNote: "작은 생활 흠집",
      askingPrice: 170000,
      photoChecklist: {
        front: true,
        back: true,
        detail: false,
        components: true,
      },
    });
    expect(body.draft.generatedText).toContain("AirPods Pro");
    expect(body.draft.generatedText).toContain("구성품: 2/3");
    expect(body.draft.generatedText).toContain("구매 증빙: 있음");
    expect(body.draft.generatedText).not.toContain(SECRET_STORAGE_KEY);

    const persisted = await prisma.item.findUnique({
      where: { id: item.id },
      include: { resaleDraft: true },
    });
    expect(persisted?.status).toBe("SELL_PREPARING");
    expect(persisted?.resaleDraft?.generatedText).toBe(body.draft.generatedText);
  });

  it("merges partial saves without losing earlier step data", async () => {
    const item = await createRichItem();

    const first = await PATCH(
      request(`http://localhost/api/items/${item.id}/resale`, {
        method: "PATCH",
        body: JSON.stringify({
          conditionGrade: "FAIR",
          defectNote: "모서리 흠집",
          photoChecklist: { front: true, back: false, detail: false, components: false },
        }),
      }),
      context(item.id),
    );
    expect(first.status).toBe(200);

    const second = await PATCH(
      request(`http://localhost/api/items/${item.id}/resale`, {
        method: "PATCH",
        body: JSON.stringify({ askingPrice: 160000 }),
      }),
      context(item.id),
    );
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      draft: {
        conditionGrade: "FAIR",
        defectNote: "모서리 흠집",
        askingPrice: 160000,
        photoChecklist: { front: true, back: false, detail: false, components: false },
      },
    });
  });

  it("gets the owner's current draft", async () => {
    const item = await createRichItem();
    await prisma.resaleDraft.create({
      data: {
        itemId: item.id,
        conditionGrade: "GOOD",
        defectNote: null,
        askingPrice: 170000,
        generatedText: "safe copy",
        photoChecklist: { front: true, back: true, detail: true, components: true },
      },
    });

    const response = await GET(request(`http://localhost/api/items/${item.id}/resale`), context(item.id));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      draft: { itemId: item.id, generatedText: "safe copy" },
    });
  });

  it("returns the same 404 for cross-user and missing item access", async () => {
    const item = await createRichItem(USER_A);
    const missingId = "00000000-0000-4000-8000-000000000999";

    const crossUser = await GET(
      request(`http://localhost/api/items/${item.id}/resale`, {}, USER_B),
      context(item.id),
    );
    const missing = await GET(
      request(`http://localhost/api/items/${missingId}/resale`, {}, USER_B),
      context(missingId),
    );

    expect(crossUser.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await crossUser.json()).toEqual(await missing.json());
  });
});
