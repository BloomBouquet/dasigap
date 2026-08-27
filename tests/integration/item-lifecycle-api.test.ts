import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "../../src/db/prisma";
import { GET as GET_COMPONENTS, PATCH as PATCH_COMPONENT, POST as POST_COMPONENT } from "../../app/api/items/[id]/components/route";
import { GET as GET_LIFECYCLE, PATCH as PATCH_LIFECYCLE } from "../../app/api/items/[id]/lifecycle/route";
import { GET as GET_MAINTENANCE, POST as POST_MAINTENANCE } from "../../app/api/items/[id]/maintenance/route";

const DEV_USER_HEADER = "x-dasigap-dev-user";
const OWNER = "t6-owner";
const OTHER = "t6-other";

function request(url: string, init: RequestInit = {}, userId = OWNER) {
  const headers = new Headers(init.headers);
  headers.set(DEV_USER_HEADER, userId);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(url, { ...init, headers });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function createFixture() {
  return prisma.item.create({
    data: {
      userId: OWNER,
      name: "AirPods Pro",
      category: "오디오",
      purchaseDate: new Date("2026-08-20T00:00:00.000Z"),
      purchasePrice: 249000,
    },
  });
}

describe("item lifecycle supporting APIs", () => {
  beforeEach(async () => {
    vi.stubEnv("AUTH_MODE", "dev");
    vi.stubEnv("NODE_ENV", "test");
    await prisma.item.deleteMany({ where: { userId: { in: [OWNER, OTHER] } } });
  });

  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => prisma.$disconnect());

  it("stores explicit return and warranty dates without timezone date shifting", async () => {
    const item = await createFixture();
    const response = await PATCH_LIFECYCLE(
      request(`http://localhost/api/items/${item.id}/lifecycle`, {
        method: "PATCH",
        body: JSON.stringify({
          returnDeadline: "2026-09-03",
          warrantyStartsAt: "2026-08-20",
          warrantyEndsAt: "2027-08-19",
        }),
      }),
      context(item.id),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      lifecycle: {
        returnDeadline: "2026-09-03",
        warranty: { startsAt: "2026-08-20", endsAt: "2027-08-19" },
      },
    });

    const getResponse = await GET_LIFECYCLE(
      request(`http://localhost/api/items/${item.id}/lifecycle`),
      context(item.id),
    );
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      lifecycle: {
        returnDeadline: "2026-09-03",
        warranty: { startsAt: "2026-08-20", endsAt: "2027-08-19" },
      },
    });
  });

  it("mutates a component checklist only for the owner", async () => {
    const item = await createFixture();
    const createdResponse = await POST_COMPONENT(
      request(`http://localhost/api/items/${item.id}/components`, {
        method: "POST",
        body: JSON.stringify({ name: "충전 케이블" }),
      }),
      context(item.id),
    );
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created.component).toMatchObject({ name: "충전 케이블", isPresent: true });

    const patchedResponse = await PATCH_COMPONENT(
      request(`http://localhost/api/items/${item.id}/components`, {
        method: "PATCH",
        body: JSON.stringify({ id: created.component.id, isPresent: false }),
      }),
      context(item.id),
    );
    expect(patchedResponse.status).toBe(200);
    await expect(patchedResponse.json()).resolves.toMatchObject({
      component: { id: created.component.id, isPresent: false },
    });

    const listResponse = await GET_COMPONENTS(
      request(`http://localhost/api/items/${item.id}/components`),
      context(item.id),
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      components: [{ name: "충전 케이블", isPresent: false }],
    });

    const crossUserResponse = await PATCH_COMPONENT(
      request(
        `http://localhost/api/items/${item.id}/components`,
        {
          method: "PATCH",
          body: JSON.stringify({ id: created.component.id, isPresent: true }),
        },
        OTHER,
      ),
      context(item.id),
    );
    expect(crossUserResponse.status).toBe(404);
  });

  it("adds and lists allowed maintenance history while hiding cross-user existence", async () => {
    const item = await createFixture();
    const createdResponse = await POST_MAINTENANCE(
      request(`http://localhost/api/items/${item.id}/maintenance`, {
        method: "POST",
        body: JSON.stringify({
          type: "DAMAGE",
          occurredAt: "2026-08-25",
          note: "오른쪽 케이스에 작은 흠집",
        }),
      }),
      context(item.id),
    );
    expect(createdResponse.status).toBe(201);
    await expect(createdResponse.json()).resolves.toMatchObject({
      maintenance: {
        type: "DAMAGE",
        occurredAt: "2026-08-25",
        note: "오른쪽 케이스에 작은 흠집",
      },
    });

    const listResponse = await GET_MAINTENANCE(
      request(`http://localhost/api/items/${item.id}/maintenance`),
      context(item.id),
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      maintenance: [{ type: "DAMAGE", occurredAt: "2026-08-25" }],
    });

    const crossUserResponse = await GET_MAINTENANCE(
      request(`http://localhost/api/items/${item.id}/maintenance`, {}, OTHER),
      context(item.id),
    );
    expect(crossUserResponse.status).toBe(404);
  });
});
