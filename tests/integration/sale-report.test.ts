import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as POST_SALE } from "../../app/api/items/[id]/sale/route";
import { GET as GET_REPORT } from "../../app/api/report/route";
import { prisma } from "../../src/db/prisma";

const DEV_USER_HEADER = "x-dasigap-dev-user";
const USER_A = "sale-report-user-a";
const USER_B = "sale-report-user-b";
const USERS = [USER_A, USER_B];

function request(url: string, init: RequestInit = {}, userId: string | null = USER_A) {
  const headers = new Headers(init.headers);
  if (userId) headers.set(DEV_USER_HEADER, userId);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(url, { ...init, headers });
}

function itemContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function createItem(userId = USER_A, overrides: Record<string, unknown> = {}) {
  return prisma.item.create({
    data: {
      userId,
      name: "AirPods Pro",
      category: "Audio",
      purchaseDate: new Date("2026-01-01T00:00:00.000Z"),
      purchasePrice: 249000,
      status: "OWNED",
      ...overrides,
    },
  });
}

describe("sale record and usage-cost report", () => {
  beforeEach(async () => {
    vi.stubEnv("AUTH_MODE", "dev");
    vi.stubEnv("NODE_ENV", "test");
    await prisma.productEvent.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.item.deleteMany({ where: { userId: { in: USERS } } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await prisma.productEvent.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.item.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.$disconnect();
  });

  it("creates one final sale, marks the item SOLD, and records SALE_COMPLETED atomically", async () => {
    const item = await createItem();

    const response = await POST_SALE(
      request(`http://localhost/api/items/${item.id}/sale`, {
        method: "POST",
        body: JSON.stringify({ soldAt: "2026-08-01", soldPrice: 170000, channel: "당근" }),
      }),
      itemContext(item.id),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      sale: { itemId: item.id, soldPrice: 170000, channel: "당근" },
    });

    const persisted = await prisma.item.findUnique({
      where: { id: item.id },
      include: { saleRecord: true },
    });
    expect(persisted?.status).toBe("SOLD");
    expect(persisted?.saleRecord?.soldPrice).toBe(170000);

    const saleEvents = await prisma.productEvent.findMany({
      where: { userId: USER_A, itemId: item.id, type: "SALE_COMPLETED" },
    });
    expect(saleEvents).toHaveLength(1);
  });

  it("keeps sale completion available when expired-event cleanup fails", async () => {
    const item = await createItem();
    vi.spyOn(prisma.productEvent, "deleteMany").mockRejectedValueOnce(
      new Error("retention cleanup unavailable"),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST_SALE(
      request(`http://localhost/api/items/${item.id}/sale`, {
        method: "POST",
        body: JSON.stringify({ soldAt: "2026-08-01", soldPrice: 170000 }),
      }),
      itemContext(item.id),
    );

    expect(response.status).toBe(201);
    expect(
      await prisma.productEvent.count({
        where: { userId: USER_A, itemId: item.id, type: "SALE_COMPLETED" },
      }),
    ).toBe(1);
  });

  it("rejects invalid sale data without changing item state", async () => {
    const item = await createItem();

    const beforePurchase = await POST_SALE(
      request(`http://localhost/api/items/${item.id}/sale`, {
        method: "POST",
        body: JSON.stringify({ soldAt: "2025-12-31", soldPrice: 170000 }),
      }),
      itemContext(item.id),
    );
    expect(beforePurchase.status).toBe(400);

    const invalidPrice = await POST_SALE(
      request(`http://localhost/api/items/${item.id}/sale`, {
        method: "POST",
        body: JSON.stringify({ soldAt: "2026-08-01", soldPrice: 0 }),
      }),
      itemContext(item.id),
    );
    expect(invalidPrice.status).toBe(400);

    const persisted = await prisma.item.findUnique({
      where: { id: item.id },
      include: { saleRecord: true },
    });
    expect(persisted?.status).toBe("OWNED");
    expect(persisted?.saleRecord).toBeNull();
    expect(
      await prisma.productEvent.count({
        where: { userId: USER_A, itemId: item.id, type: "SALE_COMPLETED" },
      }),
    ).toBe(0);
  });

  it("rejects a second final sale record without duplicating SALE_COMPLETED", async () => {
    const item = await createItem();
    const body = JSON.stringify({ soldAt: "2026-08-01", soldPrice: 170000 });

    const first = await POST_SALE(
      request(`http://localhost/api/items/${item.id}/sale`, { method: "POST", body }),
      itemContext(item.id),
    );
    expect(first.status).toBe(201);

    const second = await POST_SALE(
      request(`http://localhost/api/items/${item.id}/sale`, { method: "POST", body }),
      itemContext(item.id),
    );
    expect(second.status).toBe(400);
    expect(
      await prisma.productEvent.count({
        where: { userId: USER_A, itemId: item.id, type: "SALE_COMPLETED" },
      }),
    ).toBe(1);
  });

  it("returns sold-item cost/profit DTOs and aggregate totals only for the owner and tracks report views", async () => {
    const costItem = await createItem(USER_A, { name: "Cost item", purchasePrice: 249000 });
    const profitItem = await createItem(USER_A, { name: "Profit item", purchasePrice: 100000 });
    const otherItem = await createItem(USER_B, { name: "Other user", purchasePrice: 999999 });

    await prisma.$transaction([
      prisma.saleRecord.create({ data: { itemId: costItem.id, soldAt: new Date("2026-08-01T00:00:00.000Z"), soldPrice: 170000 } }),
      prisma.item.update({ where: { id: costItem.id }, data: { status: "SOLD" } }),
      prisma.saleRecord.create({ data: { itemId: profitItem.id, soldAt: new Date("2026-08-01T00:00:00.000Z"), soldPrice: 120000 } }),
      prisma.item.update({ where: { id: profitItem.id }, data: { status: "SOLD" } }),
      prisma.saleRecord.create({ data: { itemId: otherItem.id, soldAt: new Date("2026-08-01T00:00:00.000Z"), soldPrice: 1 } }),
      prisma.item.update({ where: { id: otherItem.id }, data: { status: "SOLD" } }),
    ]);

    const response = await GET_REPORT(request("http://localhost/api/report"));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.items).toHaveLength(2);
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: costItem.id,
          name: "Cost item",
          purchasePrice: 249000,
          soldPrice: 170000,
          usageCost: 79000,
          ownershipDays: expect.any(Number),
          monthlyUsageCost: expect.any(Number),
          kind: "COST",
        }),
        expect.objectContaining({
          itemId: profitItem.id,
          name: "Profit item",
          purchasePrice: 100000,
          soldPrice: 120000,
          usageCost: -20000,
          kind: "PROFIT",
        }),
      ]),
    );
    expect(body.summary).toEqual({
      totalPurchasePrice: 349000,
      totalRecoveredAmount: 290000,
      netUsageCost: 59000,
    });
    expect(JSON.stringify(body)).not.toContain("Other user");

    const events = await prisma.productEvent.findMany({
      where: { userId: USER_A, itemId: null },
    });
    expect(events.map((event) => String(event.type))).toContain("USAGE_COST_VIEWED");
  });

  it("returns the same 404 for cross-user and missing item sale attempts", async () => {
    const item = await createItem(USER_A);
    const saleBody = JSON.stringify({ soldAt: "2026-08-01", soldPrice: 170000 });

    const crossUser = await POST_SALE(
      request(`http://localhost/api/items/${item.id}/sale`, { method: "POST", body: saleBody }, USER_B),
      itemContext(item.id),
    );
    const missingId = "00000000-0000-4000-8000-000000000999";
    const missing = await POST_SALE(
      request(`http://localhost/api/items/${missingId}/sale`, { method: "POST", body: saleBody }, USER_B),
      itemContext(missingId),
    );

    expect(crossUser.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await crossUser.json()).toEqual(await missing.json());
  });
});
