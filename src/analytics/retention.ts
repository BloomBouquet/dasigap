import { prisma } from "../db/prisma";

export const PRODUCT_EVENT_RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

export function productEventRetentionCutoff(now = new Date()): Date {
  return new Date(now.getTime() - PRODUCT_EVENT_RETENTION_DAYS * DAY_MS);
}

export function pruneExpiredProductEvents(now = new Date()) {
  return prisma.productEvent.deleteMany({
    where: {
      createdAt: { lt: productEventRetentionCutoff(now) },
    },
  });
}
