import { expect, test } from "@playwright/test";

const OWNER = "release-owner";
const OTHER = "release-other";

function headers(userId: string) {
  return { "x-dasigap-dev-user": userId };
}

async function createItem(request: Parameters<typeof test>[0] extends never ? never : any, userId: string, name: string, purchasePrice: number) {
  const response = await request.post("/api/items", {
    headers: headers(userId),
    data: {
      name,
      category: "릴리스 검증",
      purchaseDate: "2026-01-01",
      purchasePrice,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).item as { id: string };
}

test("item detail shows registered lifecycle references and another user cannot access it", async ({ page, request }) => {
  const item = await createItem(request, OWNER, "Release Lifecycle Item", 249000);

  const lifecycle = await request.patch(`/api/items/${item.id}/lifecycle`, {
    headers: headers(OWNER),
    data: {
      returnDeadline: "2026-09-01",
      warrantyStartsAt: "2026-01-01",
      warrantyEndsAt: "2027-01-01",
    },
  });
  expect(lifecycle.status()).toBe(200);

  await page.setExtraHTTPHeaders(headers(OWNER));
  await page.goto(`/items/${item.id}`);
  await expect(page.getByRole("heading", { name: "Release Lifecycle Item" })).toBeVisible();
  await expect(page.getByText("입력한 반품기간 기준").first()).toBeVisible();
  await expect(page.getByText("등록 정보 기준 예상 보증기간").first()).toBeVisible();
  await expect(page.getByText("2026-09-01")).toBeVisible();
  await expect(page.getByText("2027-01-01")).toBeVisible();

  const otherRead = await request.get(`/api/items/${item.id}`, { headers: headers(OTHER) });
  expect(otherRead.status()).toBe(404);
  const otherWrite = await request.patch(`/api/items/${item.id}`, {
    headers: headers(OTHER),
    data: { name: "attacker edit" },
  });
  expect(otherWrite.status()).toBe(404);
});

test("sold records produce both usage cost and sale profit in the report", async ({ page, request }) => {
  const costItem = await createItem(request, OWNER, "Release Cost Item", 249000);
  const profitItem = await createItem(request, OWNER, "Release Profit Item", 100000);

  const costSale = await request.post(`/api/items/${costItem.id}/sale`, {
    headers: headers(OWNER),
    data: { soldAt: "2026-08-01", soldPrice: 170000, channel: "외부 중고거래" },
  });
  expect(costSale.status()).toBe(201);

  const profitSale = await request.post(`/api/items/${profitItem.id}/sale`, {
    headers: headers(OWNER),
    data: { soldAt: "2026-08-02", soldPrice: 120000, channel: "외부 중고거래" },
  });
  expect(profitSale.status()).toBe(201);

  const report = await request.get("/api/report", { headers: headers(OWNER) });
  expect(report.status()).toBe(200);
  const reportBody = await report.json();

  expect(reportBody.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ itemId: costItem.id, kind: "COST", usageCost: 79000 }),
      expect.objectContaining({ itemId: profitItem.id, kind: "PROFIT", usageCost: -20000 }),
    ]),
  );

  await page.setExtraHTTPHeaders(headers(OWNER));
  await page.goto("/report");
  await expect(page.getByRole("heading", { name: "사용비 리포트" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Release Cost Item" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Release Profit Item" })).toBeVisible();
  await expect(page.getByText("79,000원")).toBeVisible();
  await expect(page.getByText("판매 차익")).toBeVisible();
  await expect(page.getByText("20,000원")).toBeVisible();

  const otherReport = await request.get("/api/report", { headers: headers(OTHER) });
  expect(otherReport.status()).toBe(200);
  const otherBody = await otherReport.json();
  expect(otherBody.items).toEqual([]);
});
