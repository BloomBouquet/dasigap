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
    await prisma.item.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("never exposes another user's item through list or read", async () => {
    const item = await createItem("user-a", itemInput);

    await expect(listItems("user-b")).resolves.toEqual([]);

    const crossUser = await captureNotFound(() => getOwnedItem("user-b", item.id));
    const nonexistent = await captureNotFound(() =>
      getOwnedItem("user-b", "00000000-0000-4000-8000-000000000999"),
    );

    expect(crossUser).toEqual(nonexistent);
  });

  it("prevents cross-user update without revealing item existence", async () => {
    const item = await createItem("user-a", itemInput);

    const crossUser = await captureNotFound(() =>
      updateOwnedItem("user-b", item.id, { name: "Stolen update" }),
    );
    const nonexistent = await captureNotFound(() =>
      updateOwnedItem("user-b", "00000000-0000-4000-8000-000000000999", {
        name: "Stolen update",
      }),
    );

    expect(crossUser).toEqual(nonexistent);
    await expect(getOwnedItem("user-a", item.id)).resolves.toMatchObject({
      name: "AirPods Pro",
    });
  });

  it("prevents cross-user delete without revealing item existence", async () => {
    const item = await createItem("user-a", itemInput);

    const crossUser = await captureNotFound(() => deleteOwnedItem("user-b", item.id));
    const nonexistent = await captureNotFound(() =>
      deleteOwnedItem("user-b", "00000000-0000-4000-8000-000000000999"),
    );

    expect(crossUser).toEqual(nonexistent);
    await expect(getOwnedItem("user-a", item.id)).resolves.toMatchObject({ id: item.id });
  });
});
