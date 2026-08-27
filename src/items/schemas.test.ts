import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createItemSchema, updateItemSchema } from "./schemas";

const validItem = {
  name: "  AirPods Pro  ",
  category: "  Audio  ",
  brand: "  Apple  ",
  modelName: "  A3047  ",
  storeName: "  Apple Store  ",
  purchasePrice: 249000,
  purchaseDate: "2026-08-27",
};

describe("item schemas", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("trims item text fields and accepts a valid KRW price", () => {
    expect(createItemSchema.parse(validItem)).toMatchObject({
      name: "AirPods Pro",
      category: "Audio",
      brand: "Apple",
      modelName: "A3047",
      storeName: "Apple Store",
      purchasePrice: 249000,
    });
  });

  it.each([0, -1, 10.5])("rejects invalid purchase price %s", (purchasePrice) => {
    expect(() => createItemSchema.parse({ ...validItem, purchasePrice })).toThrow();
  });

  it("rejects a purchase date more than one day in the future", () => {
    expect(() =>
      createItemSchema.parse({ ...validItem, purchaseDate: "2026-08-29" }),
    ).toThrow();
  });

  it("rejects an invalid calendar date", () => {
    expect(() =>
      createItemSchema.parse({ ...validItem, purchaseDate: "2026-02-30" }),
    ).toThrow();
  });

  it("rejects empty or overlong required text", () => {
    expect(() => createItemSchema.parse({ ...validItem, name: "   " })).toThrow();
    expect(() =>
      createItemSchema.parse({ ...validItem, category: "x".repeat(61) }),
    ).toThrow();
  });

  it("allows partial updates but validates provided fields", () => {
    expect(updateItemSchema.parse({ name: "  New name  " })).toEqual({ name: "New name" });
    expect(() => updateItemSchema.parse({ purchasePrice: 0 })).toThrow();
  });
});
