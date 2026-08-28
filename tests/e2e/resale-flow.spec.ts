import { expect, test } from "@playwright/test";

test("owner prepares a privacy-safe resale draft on mobile", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 320, height: 720 });

  const productEvents: Array<{ type?: string; itemId?: string }> = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/api/product-events") || request.method() !== "POST") {
      return;
    }

    try {
      productEvents.push(request.postDataJSON() as { type?: string; itemId?: string });
    } catch {
      // The assertions below fail if a valid event payload was not sent.
    }
  });

  const itemResponse = await page.request.post("/api/items", {
    data: {
      name: "AirPods Pro",
      category: "오디오",
      purchaseDate: "2026-01-15",
      purchasePrice: 249000,
      brand: "Apple",
      modelName: "A3047",
      storeName: "Apple Store",
    },
  });
  expect(itemResponse.status()).toBe(201);
  const { item } = await itemResponse.json();

  const componentIds: string[] = [];
  for (const name of ["본체", "충전 케이블", "박스"]) {
    const response = await page.request.post(`/api/items/${item.id}/components`, {
      data: { name },
    });
    expect(response.status()).toBe(201);
    const body = await response.json();
    componentIds.push(body.component.id);
  }
  const missingBox = await page.request.patch(`/api/items/${item.id}/components`, {
    data: { id: componentIds[2], isPresent: false },
  });
  expect(missingBox.status()).toBe(200);

  await page.goto(`/items/${item.id}/resale`);
  await expect(page.getByRole("heading", { name: "판매 준비" })).toBeVisible();
  expect(await page.locator("body").evaluate((body) => body.scrollWidth)).toBeLessThanOrEqual(320);
  await expect
    .poll(() => productEvents.some((event) => event.type === "RESALE_STARTED" && event.itemId === item.id))
    .toBe(true);

  await page.getByLabel("좋음").check();
  await page.getByRole("button", { name: "저장하고 다음" }).click();

  await page.getByLabel("흠집/하자 메모").fill("케이스에 작은 생활 흠집");
  await page.getByRole("button", { name: "저장하고 다음" }).click();

  await expect(page.getByText("구성품 2/3개 보유")).toBeVisible();
  await page.getByRole("button", { name: "다음" }).click();

  await page.getByLabel("앞면 사진").check();
  await page.getByLabel("뒷면 사진").check();
  await page.getByLabel("구성품 사진").check();
  await page.getByRole("button", { name: "저장하고 다음" }).click();

  await page.getByLabel("희망 가격").fill("170000");
  await page.getByRole("button", { name: "저장하고 다음" }).click();

  await expect(page.getByText("상품: AirPods Pro")).toBeVisible();
  await expect(page.getByText("모델: A3047")).toBeVisible();
  await expect(page.getByText("구성품: 2/3")).toBeVisible();
  await expect(page.getByText("희망 가격: 170,000원")).toBeVisible();
  await expect(page.getByRole("button", { name: "판매글 복사" })).toBeVisible();
  await expect(page.getByRole("button", { name: "사진 확인" })).toBeVisible();
  await expect
    .poll(() => productEvents.some((event) => event.type === "RESALE_COMPLETED" && event.itemId === item.id))
    .toBe(true);

  await page.getByRole("button", { name: "판매글 복사" }).click();
  await expect(page.getByText("판매글을 복사했습니다.")).toBeVisible();
  await expect
    .poll(() => productEvents.some((event) => event.type === "RESALE_COPY_COPIED" && event.itemId === item.id))
    .toBe(true);

  const draftResponse = await page.request.get(`/api/items/${item.id}/resale`);
  expect(draftResponse.status()).toBe(200);
  const draftBody = await draftResponse.json();
  expect(draftBody.draft).toMatchObject({
    conditionGrade: "GOOD",
    defectNote: "케이스에 작은 생활 흠집",
    askingPrice: 170000,
    photoChecklist: {
      front: true,
      back: true,
      detail: false,
      components: true,
    },
  });
  expect(draftBody.draft.generatedText).not.toContain("storageKey");
});
