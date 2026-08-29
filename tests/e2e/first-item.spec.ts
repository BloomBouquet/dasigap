import { expect, test } from "@playwright/test";

test("dev user registers the first item and sees it in the item list", async ({ page }) => {
  const productEvents: string[] = [];

  page.on("request", (request) => {
    if (!request.url().endsWith("/api/product-events") || request.method() !== "POST") {
      return;
    }

    try {
      const body = request.postDataJSON() as { type?: string };
      if (body.type) productEvents.push(body.type);
    } catch {
      // The assertion below will fail if a valid analytics request was not sent.
    }
  });

  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/items/new");

  await expect(page.getByRole("heading", { name: "물건 등록" })).toBeVisible();
  await expect.poll(() => productEvents).toContain("APP_VISITED");
  await expect.poll(() => productEvents).toContain("ITEM_REGISTRATION_STARTED");

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

  const itemRequestPromise = page.waitForRequest(
    (request) => request.url().endsWith("/api/items") && request.method() === "POST",
  );
  await registerButton.click();
  const itemRequest = await itemRequestPromise;
  const durationHeader = await itemRequest.headerValue(
    "x-dasigap-registration-duration-ms",
  );
  expect(Number(durationHeader)).toBeGreaterThanOrEqual(0);
  expect(Number(durationHeader)).toBeLessThanOrEqual(3_600_000);

  await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/i);
  await expect(page.getByRole("heading", { name: "AirPods Pro" })).toBeVisible();
  await expect(page.getByText("249,000원")).toBeVisible();

  await page.goto("/items");
  await expect(page.getByRole("heading", { name: "내 물건" })).toBeVisible();
  await expect(page.getByRole("link", { name: /AirPods Pro/ })).toBeVisible();
});
