import { expect, test } from "@playwright/test";

test("dev user registers the first item and sees it in the item list", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/items/new");

  await expect(page.getByRole("heading", { name: "물건 등록" })).toBeVisible();

  await page.getByLabel("제품명").fill("AirPods Pro");
  await page.getByLabel("카테고리").fill("오디오");
  await page.getByLabel("구매일").fill("2026-08-20");
  await page.getByLabel("구매가").fill("249000");
  await page.getByLabel("브랜드").fill("Apple");
  await page.getByLabel("모델").fill("A3047");
  await page.getByLabel("구매처").fill("Apple Store");

  const registerButton = page.getByRole("button", { name: "물건 등록" });
  await expect(registerButton).toBeVisible();

  const bodyWidth = await page.locator("body").evaluate((body) => body.scrollWidth);
  expect(bodyWidth).toBeLessThanOrEqual(320);

  await registerButton.click();

  await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/i);
  await expect(page.getByRole("heading", { name: "AirPods Pro" })).toBeVisible();
  await expect(page.getByText("249,000원")).toBeVisible();

  await page.goto("/items");
  await expect(page.getByRole("heading", { name: "내 물건" })).toBeVisible();
  await expect(page.getByRole("link", { name: /AirPods Pro/ })).toBeVisible();
});
