import { expect, test } from "@playwright/test";

const headers = (userId: string) => ({ "x-dasigap-dev-user": userId });

test("allowlisted admin can view aggregate validation cards without product navigation or visit tracking", async ({ page }) => {
  await page.setExtraHTTPHeaders(headers("e2e-user"));

  const eventRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/product-events")) {
      eventRequests.push(request.method());
    }
  });

  await page.goto("/internal/validation");

  await expect(page.getByRole("heading", { name: "Validation Ops" })).toBeVisible();
  await expect(page.getByText("첫 물건 등록")).toBeVisible();
  await expect(page.getByText("D7 재방문")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toHaveCount(0);
  expect(eventRequests).toEqual([]);
});

test("authenticated non-admin sees denial and no validation metrics", async ({ page }) => {
  await page.setExtraHTTPHeaders(headers("validation-non-admin"));
  await page.goto("/internal/validation");

  await expect(page.getByText("접근 권한이 없습니다.")).toBeVisible();
  await expect(page.getByText("D7 재방문")).toHaveCount(0);
});
