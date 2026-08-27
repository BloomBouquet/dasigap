import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../../src/db/prisma";
import { OwnedItemNotFoundError } from "../../src/db/ownership";
import {
  createItem,
  deleteOwnedItem,
  getOwnedItem,
  listItems,
  updateOwnedItem,
} from "../../src/items/repository";

const OWNER_USER = "ownership-user-a";
const OTHER_USER = "ownership-user-b";
const OWNERSHIP_USERS = [OWNER_USER, OTHER_USER];

const itemInput = {
  name: "AirPods Pro",
  category: "Audio",
  brand: "Apple",
  modelName: "A3047",
  storeName: "Apple Store",
  purchasePrice: 249000,
  purchaseDate: "2026-08-20",
};

async function captureNotFound(operation: () => Promise<unknown>) {
  try {
    await operation();
    throw new Error("Expected operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(OwnedItemNotFoundError);
    const notFound = error as OwnedItemNotFoundError;
    return { status: notFound.status, code: notFound.code, message: notFound.message };
  }
}

describe("item repository ownership guard", () => {
  beforeEach(async () => {
    await prisma.item.deleteMany({
      where: { userId: { in: OWNERSHIP_USERS } },
    });
  });

  afterAll(async () => {
    await prisma.item.deleteMany({
      where: { userId: { in: OWNERSHIP_USERS } },
    });
    await prisma.$disconnect();
  });

  it("never exposes another user's item through list or read", async () => {
    const item = await createItem(OWNER_USER, itemInput);

    await expect(listItems(OTHER_USER)).resolves.toEqual([]);

    const crossUser = await captureNotFound(() => getOwnedItem(OTHER_USER, item.id));
    const nonexistent = await captureNotFound(() =>
      getOwnedItem(OTHER_USER, "00000000-0000-4000-8000-000000000999"),
    );

    expect(crossUser).toEqual(nonexistent);
  });

  it("prevents cross-user update without revealing item existence", async () => {
    const item = await createItem(OWNER_USER, itemInput);

    const crossUser = await captureNotFound(() =>
      updateOwnedItem(OTHER_USER, item.id, { name: "Stolen update" }),
    );
    const nonexistent = await captureNotFound(() =>
      updateOwnedItem(OTHER_USER, "00000000-0000-4000-8000-000000000999", {
        name: "Stolen update",
      }),
    );

    expect(crossUser).toEqual(nonexistent);
    await expect(getOwnedItem(OWNER_USER, item.id)).resolves.toMatchObject({
      name: "AirPods Pro",
    });
  });

  it("prevents cross-user delete without revealing item existence", async () => {
    const item = await createItem(OWNER_USER, itemInput);

    const crossUser = await captureNotFound(() => deleteOwnedItem(OTHER_USER, item.id));
    const nonexistent = await captureNotFound(() =>
      deleteOwnedItem(OTHER_USER, "00000000-0000-4000-8000-000000000999"),
    );

    expect(crossUser).toEqual(nonexistent);
    await expect(getOwnedItem(OWNER_USER, item.id)).resolves.toMatchObject({ id: item.id });
  });
});
