import { describe, expect, it } from "vitest";

import {
  calendarDateDifference,
  formatCalendarDate,
  resolveLifecycleStatus,
} from "./lifecycle";

const now = new Date("2026-08-27T00:00:00Z");

describe("resolveLifecycleStatus", () => {
  it("marks a future return deadline as RETURNABLE", () => {
    expect(
      resolveLifecycleStatus({
        now,
        returnDeadline: new Date("2026-08-30T00:00:00Z"),
        resaleStarted: false,
        listedExternally: false,
        soldAt: null,
      }),
    ).toBe("RETURNABLE");
  });

  it("resolves normal unsold non-returnable items as OWNED", () => {
    expect(
      resolveLifecycleStatus({
        now,
        returnDeadline: new Date("2026-08-20T00:00:00Z"),
        resaleStarted: false,
        listedExternally: false,
        soldAt: null,
      }),
    ).toBe("OWNED");
  });

  it("marks resale preparation as SELL_PREPARING", () => {
    expect(
      resolveLifecycleStatus({
        now,
        returnDeadline: new Date("2026-08-30T00:00:00Z"),
        resaleStarted: true,
        listedExternally: false,
        soldAt: null,
      }),
    ).toBe("SELL_PREPARING");
  });

  it("marks an externally listed item as LISTED_EXTERNALLY", () => {
    expect(
      resolveLifecycleStatus({
        now,
        returnDeadline: new Date("2026-08-30T00:00:00Z"),
        resaleStarted: true,
        listedExternally: true,
        soldAt: null,
      }),
    ).toBe("LISTED_EXTERNALLY");
  });

  it("SOLD overrides every earlier state", () => {
    expect(
      resolveLifecycleStatus({
        now,
        returnDeadline: new Date("2026-08-30T00:00:00Z"),
        resaleStarted: true,
        listedExternally: true,
        soldAt: new Date("2026-08-26T00:00:00Z"),
      }),
    ).toBe("SOLD");
  });
});

describe("calendar-date lifecycle calculations", () => {
  it("calculates an exact future D-day", () => {
    expect(calendarDateDifference("2026-08-30", "2026-08-27")).toBe(3);
  });

  it("returns a negative value after a deadline", () => {
    expect(calendarDateDifference("2026-08-20", "2026-08-27")).toBe(-7);
  });

  it("counts the leap day while crossing February in a leap year", () => {
    expect(calendarDateDifference("2028-03-01", "2028-02-28")).toBe(2);
  });

  it("keeps a database calendar date stable regardless of Korea offset", () => {
    const storedDate = new Date("2026-08-27T00:00:00.000Z");

    expect(formatCalendarDate(storedDate)).toBe("2026-08-27");
  });
});
