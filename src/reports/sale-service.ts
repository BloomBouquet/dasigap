import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../db/prisma";
import { getOwnedItem } from "../items/repository";
import { calculateUsageCost } from "./usage-cost";

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseCalendarDate(value: string): Date | null {
  if (!CALENDAR_DATE.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

const soldAtSchema = z
  .string()
  .trim()
  .refine((value) => parseCalendarDate(value) !== null, "Invalid calendar date")
  .transform((value) => parseCalendarDate(value) as Date);

const optionalChannel = z
  .string()
  .trim()
  .max(80)
  .optional()
  .transform((value) => (value === "" ? null : value));

export const saleInputSchema = z
  .object({
    soldAt: soldAtSchema,
    soldPrice: z.number().int().min(1),
    channel: optionalChannel,
  })
  .strict();

export class SaleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaleValidationError";
  }
}

export type SaleInput = z.input<typeof saleInputSchema>;

export async function recordOwnedItemSale(userId: string, itemId: string, input: SaleInput) {
  const parsed = saleInputSchema.parse(input);
  const item = await getOwnedItem(userId, itemId);

  if (parsed.soldAt.getTime() < item.purchaseDate.getTime()) {
    throw new SaleValidationError("판매일은 구매일보다 빠를 수 없습니다.");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.saleRecord.findUnique({ where: { itemId } });
      if (existing) throw new SaleValidationError("이미 판매 완료 처리된 물건입니다.");

      const sale = await tx.saleRecord.create({
        data: {
          itemId,
          soldAt: parsed.soldAt,
          soldPrice: parsed.soldPrice,
          channel: parsed.channel,
        },
      });

      const updated = await tx.item.updateMany({
        where: { id: itemId, userId },
        data: { status: "SOLD" },
      });
      if (updated.count !== 1) {
        throw new SaleValidationError("판매 상태를 저장하지 못했습니다.");
      }

      await tx.productEvent.create({
        data: {
          userId,
          itemId,
          type: "SALE_COMPLETED",
        },
      });

      return sale;
    });
  } catch (error) {
    if (error instanceof SaleValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new SaleValidationError("이미 판매 완료 처리된 물건입니다.");
    }
    throw error;
  }
}

export async function getOwnedUsageCostReport(userId: string) {
  const soldItems = await prisma.item.findMany({
    where: {
      userId,
      status: "SOLD",
      saleRecord: { isNot: null },
    },
    include: { saleRecord: true },
    orderBy: { updatedAt: "desc" },
  });

  const items = soldItems.flatMap((item) => {
    if (!item.saleRecord) return [];
    const cost = calculateUsageCost({
      purchasePrice: item.purchasePrice,
      soldPrice: item.saleRecord.soldPrice,
      purchaseDate: item.purchaseDate,
      soldAt: item.saleRecord.soldAt,
    });

    return [
      {
        itemId: item.id,
        name: item.name,
        purchasePrice: item.purchasePrice,
        soldPrice: item.saleRecord.soldPrice,
        usageCost: cost.usageCost,
        monthlyUsageCost: cost.monthlyUsageCost,
        ownershipDays: cost.ownershipDays,
        kind: cost.kind,
      },
    ];
  });

  return {
    items,
    summary: {
      totalPurchasePrice: items.reduce((sum, item) => sum + item.purchasePrice, 0),
      totalRecoveredAmount: items.reduce((sum, item) => sum + item.soldPrice, 0),
      netUsageCost: items.reduce((sum, item) => sum + item.usageCost, 0),
    },
  };
}
