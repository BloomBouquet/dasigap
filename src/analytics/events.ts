import type { ProductEventType } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../db/prisma";

const unscopedClientEventSchema = z
  .object({
    type: z.enum(["APP_VISITED", "ITEM_REGISTRATION_STARTED"]),
  })
  .strict();

const scopedClientEventSchema = z
  .object({
    type: z.enum([
      "RESALE_STARTED",
      "RESALE_COMPLETED",
      "RESALE_COPY_COPIED",
    ]),
    itemId: z.string().uuid(),
  })
  .strict();

export const clientProductEventSchema = z.union([
  unscopedClientEventSchema,
  scopedClientEventSchema,
]);

export type ClientProductEvent = z.infer<typeof clientProductEventSchema>;

export function parseRegistrationDuration(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;

  const duration = Number(value);
  if (!Number.isSafeInteger(duration) || duration < 0 || duration > 3_600_000) {
    return null;
  }

  return duration;
}

export type RecordProductEventInput = {
  userId: string;
  itemId?: string | null;
  type: ProductEventType;
  durationMs?: number | null;
};

export function recordProductEvent(input: RecordProductEventInput) {
  return prisma.productEvent.create({
    data: {
      userId: input.userId,
      itemId: input.itemId ?? null,
      type: input.type,
      durationMs: input.durationMs ?? null,
    },
  });
}
