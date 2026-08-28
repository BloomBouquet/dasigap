import type { ProductEventType } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../db/prisma";
import { pruneExpiredProductEvents } from "./retention";

const MAX_REGISTRATION_DURATION_MS = 1_800_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

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

/**
 * Legacy parser kept for backwards-compatible unit coverage only.
 * Product registration no longer trusts this client-provided duration.
 */
export function parseRegistrationDuration(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;

  const duration = Number(value);
  if (!Number.isSafeInteger(duration) || duration < 0 || duration > 3_600_000) {
    return null;
  }

  return duration;
}

export function kstDateKey(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export type RecordProductEventInput = {
  userId: string;
  itemId?: string | null;
  type: ProductEventType;
  durationMs?: number | null;
  dedupeKey?: string | null;
};

function eventData(input: RecordProductEventInput) {
  return {
    userId: input.userId,
    itemId: input.itemId ?? null,
    type: input.type,
    durationMs: input.durationMs ?? null,
    dedupeKey: input.dedupeKey ?? null,
  };
}

export async function recordProductEvent(input: RecordProductEventInput) {
  await pruneExpiredProductEvents();
  return prisma.productEvent.create({ data: eventData(input) });
}

export async function recordProductEventOnce(input: RecordProductEventInput) {
  if (!input.dedupeKey) {
    return recordProductEvent(input);
  }

  await pruneExpiredProductEvents();
  return prisma.productEvent.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: eventData(input),
    update: {},
  });
}

export async function resolveRegistrationDurationMs(
  userId: string,
  startEventId: string,
  completedAt: Date,
): Promise<number | null> {
  const started = await prisma.productEvent.findFirst({
    where: {
      id: startEventId,
      userId,
      type: "ITEM_REGISTRATION_STARTED",
    },
    select: { createdAt: true },
  });

  if (!started) return null;

  const durationMs = completedAt.getTime() - started.createdAt.getTime();
  if (durationMs < 0 || durationMs > MAX_REGISTRATION_DURATION_MS) return null;

  return durationMs;
}
