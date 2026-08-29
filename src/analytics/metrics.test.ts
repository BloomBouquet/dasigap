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

const OBSERVATION = new Date("2026-09-05T00:00:00.000Z");

describe("product validation metrics", () => {
  it("computes conversion, duration, retention, resale, lifecycle and report usage", () => {
    const metrics = computeValidationMetrics(
      [
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
      ],
      OBSERVATION,
    );

    expect(metrics.firstItem).toEqual({
      startedUsers: 2,
      completedUsers: 2,
      conversionRate: 1,
    });
    expect(metrics.registrationDuration).toEqual({ sampleSize: 2, medianMs: 90_000 });
    expect(metrics.retention).toEqual({
      d7EligibleUsers: 2,
      d7Users: 1,
      d7Rate: 0.5,
      d30EligibleUsers: 2,
      d30Users: 1,
      d30Rate: 0.5,
    });
    expect(metrics.resaleCompletion).toEqual({ startedItems: 2, completedItems: 1, conversionRate: 0.5 });
    expect(metrics.copyUsage).toEqual({ completedItems: 1, copiedItems: 1, conversionRate: 1 });
    expect(metrics.saleCompletion).toEqual({ startedItems: 2, soldItems: 1, conversionRate: 0.5 });
    expect(metrics.lifecycle).toEqual({ updates: 2, uniqueUsers: 1, uniqueItems: 1 });
    expect(metrics.usageCost).toEqual({ views: 2, uniqueUsers: 1 });
  });

  it("uses first registration completion as the KST retention cohort", () => {
    const metrics = computeValidationMetrics(
      [
        event("APP_VISITED", "u1", "2026-07-20T00:00:00.000Z"),
        event("ITEM_REGISTRATION_COMPLETED", "u1", "2026-08-01T00:00:00.000Z", { itemId: "i1" }),
        event("APP_VISITED", "u1", "2026-08-07T00:00:00.000Z"),
      ],
      new Date("2026-08-10T00:00:00.000Z"),
    );

    expect(metrics.retention).toMatchObject({
      d7EligibleUsers: 1,
      d7Users: 1,
      d7Rate: 1,
    });
  });

  it("accepts D7 days 6 through 8 and excludes immature cohorts", () => {
    const metrics = computeValidationMetrics(
      [
        event("ITEM_REGISTRATION_COMPLETED", "eligible", "2026-08-01T00:00:00.000Z", { itemId: "i1" }),
        event("APP_VISITED", "eligible", "2026-08-09T00:00:00.000Z"),
        event("ITEM_REGISTRATION_COMPLETED", "immature", "2026-08-05T00:00:00.000Z", { itemId: "i2" }),
      ],
      new Date("2026-08-10T00:00:00.000Z"),
    );

    expect(metrics.retention.d7EligibleUsers).toBe(1);
    expect(metrics.retention.d7Users).toBe(1);
    expect(metrics.retention.d7Rate).toBe(1);
  });

  it("uses D30 days 27 through 33 after the whole window is observable", () => {
    const metrics = computeValidationMetrics(
      [
        event("ITEM_REGISTRATION_COMPLETED", "u1", "2026-07-01T00:00:00.000Z", { itemId: "i1" }),
        event("APP_VISITED", "u1", "2026-07-29T00:00:00.000Z"),
      ],
      new Date("2026-08-04T00:00:00.000Z"),
    );

    expect(metrics.retention).toMatchObject({
      d30EligibleUsers: 1,
      d30Users: 1,
      d30Rate: 1,
    });
  });

  it("counts funnel numerators only when the same user or item belongs to the denominator cohort", () => {
    const metrics = computeValidationMetrics(
      [
        event("ITEM_REGISTRATION_STARTED", "started-user", "2026-08-01T00:00:00.000Z"),
        event("ITEM_REGISTRATION_COMPLETED", "other-user", "2026-08-01T00:01:00.000Z", { itemId: "other-item" }),
        event("RESALE_STARTED", "u1", "2026-08-01T00:00:00.000Z", { itemId: "started-item" }),
        event("RESALE_COMPLETED", "u2", "2026-08-01T00:01:00.000Z", { itemId: "completed-only" }),
        event("RESALE_COPY_COPIED", "u3", "2026-08-01T00:02:00.000Z", { itemId: "copied-only" }),
        event("SALE_COMPLETED", "u4", "2026-08-01T00:03:00.000Z", { itemId: "sold-only" }),
      ],
      OBSERVATION,
    );

    expect(metrics.firstItem).toEqual({ startedUsers: 1, completedUsers: 0, conversionRate: 0 });
    expect(metrics.resaleCompletion).toEqual({ startedItems: 1, completedItems: 0, conversionRate: 0 });
    expect(metrics.copyUsage).toEqual({ completedItems: 0, copiedItems: 0, conversionRate: 0 });
    expect(metrics.saleCompletion).toEqual({ startedItems: 1, soldItems: 0, conversionRate: 0 });
  });

  it("returns zero rates instead of NaN when a denominator is empty", () => {
    const metrics = computeValidationMetrics([], OBSERVATION);

    expect(metrics.firstItem.conversionRate).toBe(0);
    expect(metrics.resaleCompletion.conversionRate).toBe(0);
    expect(metrics.copyUsage.conversionRate).toBe(0);
    expect(metrics.saleCompletion.conversionRate).toBe(0);
    expect(metrics.retention.d7Rate).toBe(0);
    expect(metrics.retention.d30Rate).toBe(0);
    expect(metrics.registrationDuration.medianMs).toBeNull();
  });
});
