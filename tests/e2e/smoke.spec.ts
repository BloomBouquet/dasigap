import { expect, test } from "@playwright/test";

test("home exposes the Dasigap product name", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "다시값" })).toBeVisible();
});
