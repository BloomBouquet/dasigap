import { z } from "zod";

import { prisma } from "../db/prisma";
import { throwOwnedItemNotFound } from "../db/ownership";
import { formatCalendarDate } from "./lifecycle";

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

const calendarDateSchema = z
  .string()
  .trim()
  .regex(CALENDAR_DATE, "Invalid calendar date")
  .transform((value, ctx) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      ctx.addIssue({ code: "custom", message: "Invalid calendar date" });
      return z.NEVER;
    }
    return date;
  });

const optionalNullableDate = z.union([calendarDateSchema, z.null()]).optional();

export const lifecycleUpdateSchema = z
  .object({
    returnDeadline: optionalNullableDate,
    warrantyStartsAt: optionalNullableDate,
    warrantyEndsAt: optionalNullableDate,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.warrantyEndsAt instanceof Date && !(data.warrantyStartsAt instanceof Date)) {
      ctx.addIssue({
        code: "custom",
        path: ["warrantyStartsAt"],
        message: "Warranty start date is required when an end date is set",
      });
      return;
    }

    if (
      data.warrantyStartsAt instanceof Date &&
      data.warrantyEndsAt instanceof Date &&
      data.warrantyEndsAt < data.warrantyStartsAt
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["warrantyEndsAt"],
        message: "Warranty end date cannot be before the start date",
      });
    }
  });

const componentCreateSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();
const componentPatchSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    isPresent: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.isPresent !== undefined, {
    message: "At least one component field must be updated",
  });

const maintenanceCreateSchema = z
  .object({
    type: z.enum(["REPAIR", "REPLACEMENT", "DAMAGE", "CONDITION", "NOTE"]),
    occurredAt: calendarDateSchema,
    note: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((value) => (value === "" ? null : value)),
  })
  .strict();

function lifecycleBody(item: {
  returnDeadline: Date | null;
  warrantyRecords: Array<{ startsAt: Date; endsAt: Date | null }>;
}) {
  const warranty = item.warrantyRecords[0] ?? null;
  return {
    returnDeadline: item.returnDeadline ? formatCalendarDate(item.returnDeadline) : null,
    warranty: warranty
      ? {
          startsAt: formatCalendarDate(warranty.startsAt),
          endsAt: warranty.endsAt ? formatCalendarDate(warranty.endsAt) : null,
        }
      : null,
  };
}

async function findOwnedLifecycle(userId: string, itemId: string) {
  const item = await prisma.item.findFirst({
    where: { id: itemId, userId },
    select: {
      returnDeadline: true,
      warrantyRecords: {
        orderBy: { startsAt: "desc" },
        take: 1,
        select: { startsAt: true, endsAt: true },
      },
    },
  });
  if (!item) throwOwnedItemNotFound();
  return item;
}

export async function getOwnedLifecycle(userId: string, itemId: string) {
  return lifecycleBody(await findOwnedLifecycle(userId, itemId));
}

export async function updateOwnedLifecycle(userId: string, itemId: string, input: unknown) {
  const data = lifecycleUpdateSchema.parse(input);

  await prisma.$transaction(async (transaction) => {
    const owned = await transaction.item.findFirst({ where: { id: itemId, userId }, select: { id: true } });
    if (!owned) throwOwnedItemNotFound();

    if (data.returnDeadline !== undefined) {
      await transaction.item.update({
        where: { id: itemId },
        data: { returnDeadline: data.returnDeadline },
      });
    }

    if (data.warrantyStartsAt !== undefined || data.warrantyEndsAt !== undefined) {
      await transaction.warrantyRecord.deleteMany({ where: { itemId } });
      if (data.warrantyStartsAt instanceof Date) {
        await transaction.warrantyRecord.create({
          data: {
            itemId,
            startsAt: data.warrantyStartsAt,
            endsAt: data.warrantyEndsAt instanceof Date ? data.warrantyEndsAt : null,
          },
        });
      }
    }
  });

  return getOwnedLifecycle(userId, itemId);
}

export async function listOwnedComponents(userId: string, itemId: string) {
  await findOwnedLifecycle(userId, itemId);
  return prisma.component.findMany({ where: { itemId }, orderBy: { name: "asc" } });
}

export async function createOwnedComponent(userId: string, itemId: string, input: unknown) {
  const data = componentCreateSchema.parse(input);
  await findOwnedLifecycle(userId, itemId);
  return prisma.component.create({ data: { itemId, name: data.name } });
}

export async function patchOwnedComponent(userId: string, itemId: string, input: unknown) {
  const data = componentPatchSchema.parse(input);
  await findOwnedLifecycle(userId, itemId);
  const updated = await prisma.component.updateMany({
    where: { id: data.id, itemId },
    data: { name: data.name, isPresent: data.isPresent },
  });
  if (updated.count !== 1) throwOwnedItemNotFound();
  const component = await prisma.component.findFirst({ where: { id: data.id, itemId } });
  if (!component) throwOwnedItemNotFound();
  return component;
}

function maintenanceBody(record: {
  id: string;
  type: "REPAIR" | "REPLACEMENT" | "DAMAGE" | "CONDITION" | "NOTE";
  occurredAt: Date;
  note: string | null;
}) {
  return { ...record, occurredAt: formatCalendarDate(record.occurredAt) };
}

export async function listOwnedMaintenance(userId: string, itemId: string) {
  await findOwnedLifecycle(userId, itemId);
  const records = await prisma.maintenanceRecord.findMany({
    where: { itemId },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
  });
  return records.map(maintenanceBody);
}

export async function createOwnedMaintenance(userId: string, itemId: string, input: unknown) {
  const data = maintenanceCreateSchema.parse(input);
  await findOwnedLifecycle(userId, itemId);
  const record = await prisma.maintenanceRecord.create({
    data: {
      itemId,
      type: data.type,
      occurredAt: data.occurredAt,
      note: data.note,
    },
  });
  return maintenanceBody(record);
}
