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

function request(duration: string, name = validItem.name) {
  return new Request("http://localhost/api/items", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [DEV_USER_HEADER]: USER_ID,
      "x-dasigap-registration-duration-ms": duration,
    },
    body: JSON.stringify({ ...validItem, name }),
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

  it("records a bounded registration duration after item creation", async () => {
    const response = await POST(request("84500"));
    expect(response.status).toBe(201);
    const body = await response.json();

    const event = await prisma.productEvent.findFirst({
      where: {
        userId: USER_ID,
        itemId: body.item.id,
        type: "ITEM_REGISTRATION_COMPLETED",
      },
    });
    expect(event?.durationMs).toBe(84500);
  });

  it("keeps item creation successful when the duration header is invalid", async () => {
    const response = await POST(request("99999999", "Second item"));
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
