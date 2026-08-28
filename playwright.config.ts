import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    extraHTTPHeaders: {
      "x-dasigap-dev-user": "e2e-user",
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
      },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    env: {
      AUTH_MODE: "dev",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://postgres:postgres@127.0.0.1:5432/dasigap",
      OBJECT_STORAGE_MODE: "memory",
      OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS: "300",
      PRIVATE_DOCUMENT_BASE_URL: "http://127.0.0.1:3000",
      BOUQUET_AUTH_BASE_URL: "http://127.0.0.1:3999",
      BOUQUET_AUTH_APP_ID: "dasigap",
      BOUQUET_AUTH_REDIRECT_URI:
        "http://127.0.0.1:3000/api/auth/bouquet/callback",
      DASIGAP_POST_LOGIN_URL: "/",
    },
  },
});
