import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as POST_EVENT } from "../../app/api/product-events/route";
import { POST as POST_ITEM } from "../../app/api/items/route";
import { prisma } from "../../src/db/prisma";

const DEV_USER_HEADER = "x-dasigap-dev-user";
const USER_A = "analytics-hardening-user-a";
const USER_B = "analytics-hardening-user-b";
const USERS = [USER_A, USER_B];

function eventRequest(body: unknown, userId = USER_A) {
  return new Request("http://localhost/api/product-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [DEV_USER_HEADER]: userId,
    },
    body: JSON.stringify(body),
  });
}

function itemRequest(body: unknown, userId = USER_A, extraHeaders: Record<string, string> = {}) {
  return new Request("http://localhost/api/items", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [DEV_USER_HEADER]: userId,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

const validItem = {
  name: "Timing item",
  category: "Audio",
  purchaseDate: "2026-08-20",
  purchasePrice: 249000,
};

describe("product analytics hardening", () => {
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

  it("returns a server-created event id for registration start", async () => {
    const response = await POST_EVENT(eventRequest({ type: "ITEM_REGISTRATION_STARTED" }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.eventId).toEqual(expect.any(String));

    const stored = await prisma.productEvent.findUnique({ where: { id: body.eventId } });
    expect(stored).toMatchObject({ userId: USER_A, type: "ITEM_REGISTRATION_STARTED" });
  });

  it("derives registration duration from the owned server start event instead of a client duration", async () => {
    const startResponse = await POST_EVENT(eventRequest({ type: "ITEM_REGISTRATION_STARTED" }));
    const { eventId } = await startResponse.json();

    const response = await POST_ITEM(
      itemRequest(
        { ...validItem, registrationStartEventId: eventId },
        USER_A,
        { "x-dasigap-registration-duration-ms": "999999" },
      ),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    const completed = await prisma.productEvent.findFirst({
      where: { userId: USER_A, itemId: body.item.id, type: "ITEM_REGISTRATION_COMPLETED" },
    });

    expect(completed?.durationMs).not.toBe(999999);
    expect(completed?.durationMs).toEqual(expect.any(Number));
    expect(completed?.durationMs).toBeGreaterThanOrEqual(0);
    expect(completed?.durationMs).toBeLessThanOrEqual(1_800_000);
  });

  it("does not use another user's start event or a legacy duration header", async () => {
    const otherStart = await POST_EVENT(
      eventRequest({ type: "ITEM_REGISTRATION_STARTED" }, USER_B),
    );
    const { eventId: otherEventId } = await otherStart.json();

    const crossUserResponse = await POST_ITEM(
      itemRequest({ ...validItem, registrationStartEventId: otherEventId }, USER_A),
    );
    expect(crossUserResponse.status).toBe(201);
    const crossUserBody = await crossUserResponse.json();

    const legacyHeaderResponse = await POST_ITEM(
      itemRequest(
        { ...validItem, name: "Legacy header item" },
        USER_A,
        { "x-dasigap-registration-duration-ms": "84500" },
      ),
    );
    expect(legacyHeaderResponse.status).toBe(201);
    const legacyHeaderBody = await legacyHeaderResponse.json();

    const events = await prisma.productEvent.findMany({
      where: {
        userId: USER_A,
        type: "ITEM_REGISTRATION_COMPLETED",
        itemId: { in: [crossUserBody.item.id, legacyHeaderBody.item.id] },
      },
      orderBy: { createdAt: "asc" },
    });

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.durationMs === null)).toBe(true);
  });
});
