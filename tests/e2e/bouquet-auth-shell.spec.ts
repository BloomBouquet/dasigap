import { expect, test } from "@playwright/test";

test("anonymous users see Bouquet login without protected-content flash", async ({ page }) => {
  await page.context().setExtraHTTPHeaders({});
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "꽃다발 로그인이 필요해요" })).toBeVisible();
  await expect(page.getByRole("link", { name: "꽃다발로 로그인" })).toHaveAttribute(
    "href",
    "/auth/bouquet/start?returnTo=%2F",
  );
  await expect(page.getByRole("heading", { name: "지금 할 일" })).toHaveCount(0);
});

test("privacy policy and terms remain public before login", async ({ page }) => {
  await page.context().setExtraHTTPHeaders({});

  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "개인정보처리방침" })).toBeVisible();

  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "이용약관" })).toBeVisible();
});
