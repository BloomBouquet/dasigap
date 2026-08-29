import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../app/api/product-events/route";
import { prisma } from "../../src/db/prisma";

const DEV_USER_HEADER = "x-dasigap-dev-user";
const USER_A = "analytics-user-a";
const USER_B = "analytics-user-b";
const USERS = [USER_A, USER_B];

function request(body: unknown, userId: string | null = USER_A) {
  const headers = new Headers({ "content-type": "application/json" });
  if (userId) headers.set(DEV_USER_HEADER, userId);

  return new Request("http://localhost/api/product-events", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function createItem(userId = USER_A) {
  return prisma.item.create({
    data: {
      userId,
      name: "Analytics item",
      category: "Audio",
      purchaseDate: new Date("2026-08-20T00:00:00.000Z"),
      purchasePrice: 249000,
    },
  });
}

describe("product event API", () => {
  beforeEach(async () => {
    vi.stubEnv("AUTH_MODE", "dev");
    vi.stubEnv("NODE_ENV", "test");
    await prisma.productEvent.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.item.deleteMany({ where: { userId: { in: USERS } } });
  });

  afterEach(() => vi.unstubAllEnvs());

  afterAll(async () => {
    await prisma.productEvent.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.item.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.$disconnect();
  });

  it("requires authentication", async () => {
    const response = await POST(request({ type: "APP_VISITED" }, null));
    expect(response.status).toBe(401);
  });

  it("derives user id from authentication and rejects client supplied user ids", async () => {
    const rejected = await POST(
      request({ type: "APP_VISITED", userId: "spoofed-user" }),
    );
    expect(rejected.status).toBe(400);

    const accepted = await POST(request({ type: "APP_VISITED" }));
    expect(accepted.status).toBe(202);
    expect(accepted.headers.get("cache-control")).toBe("no-store");

    const event = await prisma.productEvent.findFirst({
      where: { userId: USER_A, type: "APP_VISITED" },
    });
    expect(event).toMatchObject({ userId: USER_A, itemId: null, durationMs: null });
  });

  it("accepts item events only for an owned item", async () => {
    const owned = await createItem(USER_A);
    const other = await createItem(USER_B);

    const accepted = await POST(
      request({ type: "RESALE_STARTED", itemId: owned.id }),
    );
    expect(accepted.status).toBe(202);

    const denied = await POST(
      request({ type: "RESALE_STARTED", itemId: other.id }),
    );
    expect(denied.status).toBe(404);

    const stored = await prisma.productEvent.findMany({
      where: { userId: USER_A, type: "RESALE_STARTED" },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].itemId).toBe(owned.id);
  });

  it("rejects arbitrary sensitive payload fields", async () => {
    for (const body of [
      { type: "APP_VISITED", metadata: { receipt: "secret" } },
      { type: "APP_VISITED", text: "generated resale copy" },
      { type: "APP_VISITED", receipt: "private-document-key" },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }

    expect(
      await prisma.productEvent.count({ where: { userId: USER_A } }),
    ).toBe(0);
  });
});
