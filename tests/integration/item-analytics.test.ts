import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../app/api/items/route";
import { prisma } from "../../src/db/prisma";

const DEV_USER_HEADER = "x-dasigap-dev-user";
const USER_ID = "item-analytics-user";

const validItem = {
  name: "AirPods Pro",
  category: "Audio",
  purchaseDate: "2026-08-20",
  purchasePrice: 249000,
};

function request(
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
) {
  return new Request("http://localhost/api/items", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [DEV_USER_HEADER]: USER_ID,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

describe("item registration analytics", () => {
  beforeEach(async () => {
    vi.stubEnv("AUTH_MODE", "dev");
    vi.stubEnv("NODE_ENV", "test");
    await prisma.productEvent.deleteMany({ where: { userId: USER_ID } });
    await prisma.item.deleteMany({ where: { userId: USER_ID } });
  });

  afterEach(() => vi.unstubAllEnvs());

  afterAll(async () => {
    await prisma.productEvent.deleteMany({ where: { userId: USER_ID } });
    await prisma.item.deleteMany({ where: { userId: USER_ID } });
    await prisma.$disconnect();
  });

  it("records registration duration from the user's server start event", async () => {
    const startEvent = await prisma.productEvent.create({
      data: {
        userId: USER_ID,
        type: "ITEM_REGISTRATION_STARTED",
        createdAt: new Date(Date.now() - 84_500),
      },
    });

    const response = await POST(
      request({ ...validItem, registrationStartEventId: startEvent.id }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();

    const event = await prisma.productEvent.findFirst({
      where: {
        userId: USER_ID,
        itemId: body.item.id,
        type: "ITEM_REGISTRATION_COMPLETED",
      },
    });
    expect(event?.durationMs).toBeGreaterThanOrEqual(84_000);
    expect(event?.durationMs).toBeLessThan(90_000);
  });

  it("keeps item creation successful and records null when no owned server start exists", async () => {
    const response = await POST(
      request(
        {
          ...validItem,
          name: "Second item",
          registrationStartEventId: "00000000-0000-4000-8000-000000000999",
        },
        { "x-dasigap-registration-duration-ms": "84500" },
      ),
    );
    expect(response.status).toBe(201);
    const body = await response.json();

    const event = await prisma.productEvent.findFirst({
      where: {
        userId: USER_ID,
        itemId: body.item.id,
        type: "ITEM_REGISTRATION_COMPLETED",
      },
    });
    expect(event?.durationMs).toBeNull();
  });
});
