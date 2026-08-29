import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../../app/api/internal/validation/route";
import { prisma } from "../../src/db/prisma";

const DEV_USER_HEADER = "x-dasigap-dev-user";
const ADMIN = "validation-admin";
const NON_ADMIN = "validation-non-admin";
const RAW_USER = "private-validation-user-raw";
const USERS = [ADMIN, NON_ADMIN, RAW_USER];

function request(userId: string | null) {
  const headers = new Headers();
  if (userId) headers.set(DEV_USER_HEADER, userId);
  return new Request("http://localhost/api/internal/validation", { headers });
}

async function seedValidationEvents() {
  const item = await prisma.item.create({
    data: {
      userId: RAW_USER,
      name: "Private validation item",
      category: "Internal validation",
      purchaseDate: new Date("2026-08-01T00:00:00.000Z"),
      purchasePrice: 199000,
    },
  });

  await prisma.productEvent.createMany({
    data: [
      {
        userId: RAW_USER,
        type: "ITEM_REGISTRATION_STARTED",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      {
        userId: RAW_USER,
        itemId: item.id,
        type: "ITEM_REGISTRATION_COMPLETED",
        durationMs: 90000,
        createdAt: new Date("2026-08-01T00:01:30.000Z"),
      },
      {
        userId: RAW_USER,
        type: "APP_VISITED",
        createdAt: new Date("2026-08-08T00:00:00.000Z"),
      },
    ],
  });

  return item;
}

describe("internal validation metrics API", () => {
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

  it("returns 401 without authentication", async () => {
    vi.stubEnv("VALIDATION_ADMIN_USER_IDS", ADMIN);

    const response = await GET(request(null));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns 503 when the admin allowlist is not configured", async () => {
    vi.stubEnv("VALIDATION_ADMIN_USER_IDS", "");

    const response = await GET(request(ADMIN));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      error: {
        code: "VALIDATION_ADMIN_NOT_CONFIGURED",
        message: "Validation console is not configured",
      },
    });
  });

  it("returns 403 to an authenticated non-admin", async () => {
    vi.stubEnv("VALIDATION_ADMIN_USER_IDS", ADMIN);

    const response = await GET(request(NON_ADMIN));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns aggregate-only metrics to an allowlisted admin without mutating analytics", async () => {
    vi.stubEnv("VALIDATION_ADMIN_USER_IDS", ` other-admin, ${ADMIN} `);
    const item = await seedValidationEvents();
    const before = await prisma.productEvent.count();

    const response = await GET(request(ADMIN));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    const body = await response.json();
    expect(body).toMatchObject({
      retentionDays: 180,
      metrics: {
        firstItem: { startedUsers: expect.any(Number), completedUsers: expect.any(Number) },
        retention: { d7EligibleUsers: expect.any(Number), d7Users: expect.any(Number) },
      },
    });
    expect(typeof body.generatedAt).toBe("string");

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(RAW_USER);
    expect(serialized).not.toContain(item.id);
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("itemId");

    expect(await prisma.productEvent.count()).toBe(before);
  });
});
