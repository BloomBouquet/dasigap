import { expect, test, type APIRequestContext } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:3000";
const DEV_USER_HEADER = "x-dasigap-dev-user";

function calendarDate(offsetDays: number) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function userHeaders(userId: string) {
  return { [DEV_USER_HEADER]: userId };
}

async function createItem(request: APIRequestContext, userId: string, name: string) {
  const response = await request.post(`${BASE_URL}/api/items`, {
    headers: userHeaders(userId),
    data: {
      name,
      category: "테스트",
      purchaseDate: calendarDate(-90),
      purchasePrice: 100000,
    },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).item as { id: string };
}

test("prioritizes return, warranty, resale, recent, and sold actions on a 320px home", async ({
  page,
  request,
}) => {
  const userId = `home-priority-${Date.now()}`;
  const headers = userHeaders(userId);
  await page.setExtraHTTPHeaders(headers);
  await page.setViewportSize({ width: 320, height: 720 });

  const returnItem = await createItem(request, userId, "반품 임박 물건");
  await request.patch(`${BASE_URL}/api/items/${returnItem.id}/lifecycle`, {
    headers,
    data: { returnDeadline: calendarDate(3) },
  });

  const warrantyItem = await createItem(request, userId, "보증 임박 물건");
  await request.patch(`${BASE_URL}/api/items/${warrantyItem.id}/lifecycle`, {
    headers,
    data: {
      warrantyStartsAt: calendarDate(-300),
      warrantyEndsAt: calendarDate(20),
    },
  });

  const resaleItem = await createItem(request, userId, "판매 준비 물건");
  await request.patch(`${BASE_URL}/api/items/${resaleItem.id}/resale`, {
    headers,
    data: { conditionGrade: "GOOD" },
  });

  await createItem(request, userId, "최근 등록 물건");

  const soldItem = await createItem(request, userId, "최근 판매 물건");
  await request.post(`${BASE_URL}/api/items/${soldItem.id}/sale`, {
    headers,
    data: { soldAt: calendarDate(0), soldPrice: 80000, channel: "테스트" },
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "지금 할 일" })).toBeVisible();
  const orderedNames = await page.locator("[data-action-item-name]").allTextContents();
  expect(orderedNames.slice(0, 5)).toEqual([
    "반품 임박 물건",
    "보증 임박 물건",
    "판매 준비 물건",
    "최근 등록 물건",
    "최근 판매 물건",
  ]);

  expect(await page.locator("body").evaluate((body) => body.scrollWidth)).toBeLessThanOrEqual(320);
});

test("exposes the install manifest and legal entry points", async ({ page, request }) => {
  await page.setExtraHTTPHeaders(userHeaders(`home-legal-${Date.now()}`));
  await page.goto("/");

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.getByRole("link", { name: "개인정보처리방침" })).toBeVisible();
  await expect(page.getByRole("link", { name: "이용약관" })).toBeVisible();

  const manifestResponse = await request.get(`${BASE_URL}/manifest.webmanifest`);
  expect(manifestResponse.ok()).toBe(true);
  await expect(manifestResponse.json()).resolves.toMatchObject({
    name: "다시값",
    short_name: "다시값",
    start_url: "/",
    display: "standalone",
  });

  await page.getByRole("link", { name: "개인정보처리방침" }).click();
  await expect(page.getByRole("heading", { name: "개인정보처리방침" })).toBeVisible();
  await expect(page.getByText("계정 사용자 ID")).toBeVisible();
  await expect(page.getByText("비공개 문서")).toBeVisible();
  await expect(page.getByRole("heading", { name: "삭제" })).toBeVisible();
  await expect(page.getByText(/객체 저장소/)).toBeVisible();
});

test("provides keyboard-focusable primary navigation", async ({ page }) => {
  await page.setExtraHTTPHeaders(userHeaders(`home-focus-${Date.now()}`));
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toBeVisible();
});
