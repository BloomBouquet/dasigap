import { describe, expect, it } from "vitest";

import {
  ValidationAdminConfigurationError,
  parseValidationAdminUserIds,
} from "./validation-admin";

describe("validation admin allowlist", () => {
  it("trims comma-separated ids and drops empty entries", () => {
    expect([...parseValidationAdminUserIds(" user-a, user-b ,,user-c ")]).toEqual([
      "user-a",
      "user-b",
      "user-c",
    ]);
  });

  it("fails closed when configuration is missing or empty", () => {
    expect(() => parseValidationAdminUserIds(undefined)).toThrow(
      ValidationAdminConfigurationError,
    );
    expect(() => parseValidationAdminUserIds(" , , ")).toThrow(
      ValidationAdminConfigurationError,
    );
  });

  it("preserves exact opaque ids instead of partial matching", () => {
    const ids = parseValidationAdminUserIds("admin-1,admin-10");
    expect(ids.has("admin-1")).toBe(true);
    expect(ids.has("admin")).toBe(false);
    expect(ids.has("admin-10")).toBe(true);
  });
});
