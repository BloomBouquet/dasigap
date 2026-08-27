import { expect, test } from "@playwright/test";

test("receipt stays private through signed access and deletion", async ({ page }) => {
  const createItem = await page.request.post("/api/items", {
    data: {
      name: "Privacy Test Laptop",
      category: "노트북",
      purchaseDate: "2026-08-20",
      purchasePrice: 1490000,
      brand: "Test",
      modelName: "P1",
      storeName: "Test Store",
    },
  });
  expect(createItem.status()).toBe(201);
  const { item } = await createItem.json();

  const upload = await page.request.post(`/api/items/${item.id}/documents`, {
    multipart: {
      type: "RECEIPT",
      file: {
        name: "private-receipt.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("receipt private content"),
      },
    },
  });
  expect(upload.status()).toBe(201);
  const uploadBody = await upload.json();
  expect(uploadBody.document.storageKey).toBeUndefined();
  expect(uploadBody.document.url).toBeUndefined();

  await page.goto(`/items/${item.id}`);
  const html = await page.content();
  expect(html).not.toContain("users/");
  expect(html).not.toContain("/api/private-documents/");

  const signed = await page.request.get(`/api/documents/${uploadBody.document.id}/signed-url`);
  expect(signed.status()).toBe(200);
  const signedBody = await signed.json();
  expect(signedBody.expiresIn).toBe(300);
  expect(signedBody.url).not.toContain("users/");

  const crossUser = await page.request.get(
    `/api/documents/${uploadBody.document.id}/signed-url`,
    { headers: { "x-dasigap-dev-user": "e2e-other" } },
  );
  expect(crossUser.status()).toBe(404);

  const privateRead = await page.request.get(signedBody.url);
  expect(privateRead.status()).toBe(200);
  expect(await privateRead.body()).toEqual(Buffer.from("receipt private content"));

  const deleted = await page.request.delete(`/api/documents/${uploadBody.document.id}`);
  expect(deleted.status()).toBe(204);

  const oldUrl = await page.request.get(signedBody.url);
  expect(oldUrl.status()).toBe(404);

  await page.request.delete(`/api/items/${item.id}`);
});
