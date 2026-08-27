import { prisma } from "../db/prisma";
import { throwOwnedItemNotFound } from "../db/ownership";
import {
  createItemSchema,
  updateItemSchema,
  type CreateItemInput,
  type UpdateItemInput,
} from "./schemas";

export async function createItem(userId: string, input: CreateItemInput) {
  const data = createItemSchema.parse(input);

  return prisma.item.create({
    data: {
      userId,
      name: data.name,
      category: data.category,
      brand: data.brand,
      modelName: data.modelName,
      storeName: data.storeName,
      purchasePrice: data.purchasePrice,
      purchaseDate: data.purchaseDate,
    },
  });
}

export async function listItems(userId: string) {
  return prisma.item.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getOwnedItem(userId: string, itemId: string) {
  const item = await prisma.item.findFirst({
    where: { id: itemId, userId },
  });

  if (!item) {
    throwOwnedItemNotFound();
  }

  return item;
}

export async function updateOwnedItem(
  userId: string,
  itemId: string,
  input: UpdateItemInput,
) {
  const data = updateItemSchema.parse(input);

  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.item.updateMany({
      where: { id: itemId, userId },
      data,
    });

    if (updated.count !== 1) {
      throwOwnedItemNotFound();
    }

    const item = await transaction.item.findFirst({
      where: { id: itemId, userId },
    });

    if (!item) {
      throwOwnedItemNotFound();
    }

    return item;
  });
}

export async function deleteOwnedItem(userId: string, itemId: string) {
  const deleted = await prisma.item.deleteMany({
    where: { id: itemId, userId },
  });

  if (deleted.count !== 1) {
    throwOwnedItemNotFound();
  }

  return { id: itemId };
}
