import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "ops/**/*.test.ts",
      "tests/ops/**/*.test.ts",
    ],
  },
});
