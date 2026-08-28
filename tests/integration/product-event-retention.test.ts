import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as POST_EVENT } from "../../app/api/product-events/route";
import { prisma } from "../../src/db/prisma";

const DEV_USER_HEADER = "x-dasigap-dev-user";
const USER_ID = "analytics-retention-user";
const DAY_MS = 24 * 60 * 60 * 1000;

function request(body: unknown) {
  return new Request("http://localhost/api/product-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [DEV_USER_HEADER]: USER_ID,
    },
    body: JSON.stringify(body),
  });
}

describe("product event raw retention", () => {
  beforeEach(async () => {
    vi.stubEnv("AUTH_MODE", "dev");
    vi.stubEnv("NODE_ENV", "test");
    await prisma.productEvent.deleteMany({ where: { userId: USER_ID } });
  });

  afterEach(() => vi.unstubAllEnvs());

  afterAll(async () => {
    await prisma.productEvent.deleteMany({ where: { userId: USER_ID } });
    await prisma.$disconnect();
  });

  it("deletes raw events older than 180 days before storing a new event", async () => {
    const now = Date.now();
    const old = await prisma.productEvent.create({
      data: {
        userId: USER_ID,
        type: "APP_VISITED",
        createdAt: new Date(now - 181 * DAY_MS),
      },
    });
    const recent = await prisma.productEvent.create({
      data: {
        userId: USER_ID,
        type: "APP_VISITED",
        createdAt: new Date(now - 179 * DAY_MS),
      },
    });

    const response = await POST_EVENT(
      request({ type: "ITEM_REGISTRATION_STARTED" }),
    );
    expect(response.status).toBe(201);

    await expect(prisma.productEvent.findUnique({ where: { id: old.id } })).resolves.toBeNull();
    await expect(prisma.productEvent.findUnique({ where: { id: recent.id } })).resolves.not.toBeNull();
  });
});
