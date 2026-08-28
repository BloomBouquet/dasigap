import { describe, expect, it } from "vitest";

import { computeValidationMetrics } from "./metrics";

function event(
  type: string,
  userId: string,
  createdAt: string,
  options: { itemId?: string | null; durationMs?: number | null } = {},
) {
  return {
    type,
    userId,
    createdAt: new Date(createdAt),
    itemId: options.itemId ?? null,
    durationMs: options.durationMs ?? null,
  };
}

describe("product validation metrics", () => {
  it("computes conversion, duration, retention, resale, lifecycle and report usage", () => {
    const metrics = computeValidationMetrics([
      event("APP_VISITED", "u1", "2026-08-01T00:00:00.000Z"),
      event("APP_VISITED", "u1", "2026-08-08T00:00:00.000Z"),
      event("APP_VISITED", "u1", "2026-08-31T00:00:00.000Z"),
      event("APP_VISITED", "u2", "2026-08-01T01:00:00.000Z"),
      event("ITEM_REGISTRATION_STARTED", "u1", "2026-08-01T00:01:00.000Z"),
      event("ITEM_REGISTRATION_STARTED", "u2", "2026-08-01T01:01:00.000Z"),
      event("ITEM_REGISTRATION_COMPLETED", "u1", "2026-08-01T00:02:00.000Z", { itemId: "i1", durationMs: 60_000 }),
      event("ITEM_REGISTRATION_COMPLETED", "u2", "2026-08-01T01:03:00.000Z", { itemId: "i2", durationMs: 120_000 }),
      event("RESALE_STARTED", "u1", "2026-08-15T00:00:00.000Z", { itemId: "i1" }),
      event("RESALE_STARTED", "u2", "2026-08-15T01:00:00.000Z", { itemId: "i2" }),
      event("RESALE_COMPLETED", "u1", "2026-08-15T00:05:00.000Z", { itemId: "i1" }),
      event("RESALE_COPY_COPIED", "u1", "2026-08-15T00:06:00.000Z", { itemId: "i1" }),
      event("SALE_COMPLETED", "u1", "2026-08-20T00:00:00.000Z", { itemId: "i1" }),
      event("ITEM_LIFECYCLE_UPDATED", "u1", "2026-08-10T00:00:00.000Z", { itemId: "i1" }),
      event("ITEM_LIFECYCLE_UPDATED", "u1", "2026-08-11T00:00:00.000Z", { itemId: "i1" }),
      event("USAGE_COST_VIEWED", "u1", "2026-08-20T00:01:00.000Z"),
      event("USAGE_COST_VIEWED", "u1", "2026-08-21T00:01:00.000Z"),
    ]);

    expect(metrics.firstItem).toEqual({
      startedUsers: 2,
      completedUsers: 2,
      conversionRate: 1,
    });
    expect(metrics.registrationDuration).toEqual({ sampleSize: 2, medianMs: 90_000 });
    expect(metrics.retention).toEqual({ cohortUsers: 2, d7Users: 1, d7Rate: 0.5, d30Users: 1, d30Rate: 0.5 });
    expect(metrics.resaleCompletion).toEqual({ startedItems: 2, completedItems: 1, conversionRate: 0.5 });
    expect(metrics.copyUsage).toEqual({ completedItems: 1, copiedItems: 1, conversionRate: 1 });
    expect(metrics.saleCompletion).toEqual({ startedItems: 2, soldItems: 1, conversionRate: 0.5 });
    expect(metrics.lifecycle).toEqual({ updates: 2, uniqueUsers: 1, uniqueItems: 1 });
    expect(metrics.usageCost).toEqual({ views: 2, uniqueUsers: 1 });
  });

  it("uses KST calendar dates for exact D7 and D30 retention", () => {
    const metrics = computeValidationMetrics([
      event("APP_VISITED", "u1", "2026-08-01T14:59:59.000Z"),
      event("APP_VISITED", "u1", "2026-08-08T15:00:00.000Z"),
      event("APP_VISITED", "u1", "2026-08-31T14:59:59.000Z"),
    ]);

    expect(metrics.retention).toEqual({ cohortUsers: 1, d7Users: 0, d7Rate: 0, d30Users: 1, d30Rate: 1 });
  });

  it("returns zero rates instead of NaN when a denominator is empty", () => {
    const metrics = computeValidationMetrics([]);

    expect(metrics.firstItem.conversionRate).toBe(0);
    expect(metrics.resaleCompletion.conversionRate).toBe(0);
    expect(metrics.copyUsage.conversionRate).toBe(0);
    expect(metrics.saleCompletion.conversionRate).toBe(0);
    expect(metrics.retention.d7Rate).toBe(0);
    expect(metrics.registrationDuration.medianMs).toBeNull();
  });
});
