import { describe, expect, it } from "vitest";

import {
  clientProductEventSchema,
  parseRegistrationDuration,
} from "./events";

describe("product event privacy contract", () => {
  it("accepts only the fixed client event names", () => {
    expect(clientProductEventSchema.parse({ type: "APP_VISITED" })).toEqual({
      type: "APP_VISITED",
    });
    expect(
      clientProductEventSchema.parse({
        type: "RESALE_STARTED",
        itemId: "00000000-0000-4000-8000-000000000001",
      }),
    ).toMatchObject({ type: "RESALE_STARTED" });

    for (const serverOnlyType of [
      "ITEM_REGISTRATION_COMPLETED",
      "ITEM_LIFECYCLE_UPDATED",
      "SALE_COMPLETED",
      "USAGE_COST_VIEWED",
    ]) {
      expect(() => clientProductEventSchema.parse({ type: serverOnlyType })).toThrow();
    }
    expect(() => clientProductEventSchema.parse({ type: "UNKNOWN" })).toThrow();
  });

  it("rejects arbitrary metadata and client supplied user ids", () => {
    expect(() =>
      clientProductEventSchema.parse({
        type: "APP_VISITED",
        userId: "spoofed-user",
      }),
    ).toThrow();
    expect(() =>
      clientProductEventSchema.parse({
        type: "APP_VISITED",
        metadata: { receipt: "secret" },
      }),
    ).toThrow();
  });

  it("requires item ids only for item-scoped resale events", () => {
    expect(() =>
      clientProductEventSchema.parse({ type: "RESALE_COMPLETED" }),
    ).toThrow();
    expect(() =>
      clientProductEventSchema.parse({
        type: "APP_VISITED",
        itemId: "00000000-0000-4000-8000-000000000001",
      }),
    ).toThrow();
  });

  it("parses only bounded integer registration durations", () => {
    expect(parseRegistrationDuration("0")).toBe(0);
    expect(parseRegistrationDuration("84500")).toBe(84500);
    expect(parseRegistrationDuration("3600000")).toBe(3600000);
    expect(parseRegistrationDuration(null)).toBeNull();
    expect(parseRegistrationDuration("-1")).toBeNull();
    expect(parseRegistrationDuration("1.5")).toBeNull();
    expect(parseRegistrationDuration("abc")).toBeNull();
    expect(parseRegistrationDuration("3600001")).toBeNull();
  });
});
