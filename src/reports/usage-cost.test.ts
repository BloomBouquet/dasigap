import { describe, expect, it } from "vitest";

import { calculateUsageCost, DomainValidationError } from "./usage-cost";

describe("calculateUsageCost", () => {
  it("calculates total usage cost for a sold item", () => {
    const result = calculateUsageCost({
      purchasePrice: 249000,
      soldPrice: 170000,
      purchaseDate: new Date("2025-08-27T00:00:00Z"),
      soldAt: new Date("2026-08-27T00:00:00Z"),
    });

    expect(result.usageCost).toBe(79000);
    expect(result.ownershipDays).toBe(365);
    expect(result.kind).toBe("COST");
  });

  it("reports resale profit without treating negative usage cost as an error", () => {
    const result = calculateUsageCost({
      purchasePrice: 100000,
      soldPrice: 120000,
      purchaseDate: new Date("2026-07-27T00:00:00Z"),
      soldAt: new Date("2026-08-27T00:00:00Z"),
    });

    expect(result.usageCost).toBe(-20000);
    expect(result.monthlyUsageCost).toBeLessThan(0);
    expect(result.kind).toBe("PROFIT");
  });

  it("uses fractional ownership months for ownership under one month", () => {
    const result = calculateUsageCost({
      purchasePrice: 100000,
      soldPrice: 90000,
      purchaseDate: new Date("2026-08-17T00:00:00Z"),
      soldAt: new Date("2026-08-27T00:00:00Z"),
    });

    expect(result.ownershipDays).toBe(10);
    expect(result.ownershipMonths).toBeCloseTo(10 / 30.4375);
  });

  it("uses one ownership day for a same-day sale", () => {
    const result = calculateUsageCost({
      purchasePrice: 100000,
      soldPrice: 90000,
      purchaseDate: new Date("2026-08-27T01:00:00Z"),
      soldAt: new Date("2026-08-27T23:00:00Z"),
    });

    expect(result.ownershipDays).toBe(1);
  });

  it("classifies equal purchase and sold prices as BREAK_EVEN", () => {
    expect(
      calculateUsageCost({
        purchasePrice: 100000,
        soldPrice: 100000,
        purchaseDate: new Date("2026-08-20T00:00:00Z"),
        soldAt: new Date("2026-08-27T00:00:00Z"),
      }).kind,
    ).toBe("BREAK_EVEN");
  });

  it("rejects a sold date before the purchase date", () => {
    expect(() =>
      calculateUsageCost({
        purchasePrice: 100000,
        soldPrice: 90000,
        purchaseDate: new Date("2026-08-28T00:00:00Z"),
        soldAt: new Date("2026-08-27T00:00:00Z"),
      }),
    ).toThrow(DomainValidationError);
  });

  it.each([
    { purchasePrice: 0, soldPrice: 90000 },
    { purchasePrice: -1, soldPrice: 90000 },
    { purchasePrice: 100000, soldPrice: 0 },
    { purchasePrice: 100000, soldPrice: -1 },
  ])("rejects non-positive prices: %o", ({ purchasePrice, soldPrice }) => {
    expect(() =>
      calculateUsageCost({
        purchasePrice,
        soldPrice,
        purchaseDate: new Date("2026-08-20T00:00:00Z"),
        soldAt: new Date("2026-08-27T00:00:00Z"),
      }),
    ).toThrow(DomainValidationError);
  });
});
