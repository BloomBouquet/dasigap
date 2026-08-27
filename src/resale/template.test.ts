import { describe, expect, it } from "vitest";

import { buildResaleTemplateInput } from "./privacy-filter";
import { generateResaleText } from "./template";

const forbiddenValues = [
  "광주광역시 북구 비밀로 123",
  "010-1234-5678",
  "ORDER-SECRET-7788",
  "4111-1111-1111-1111",
  "users/private/items/secret/documents/receipt.pdf",
];

describe("privacy-safe resale template", () => {
  it("uses an explicit allowlist and never copies receipt/private document data", () => {
    const input = buildResaleTemplateInput({
      item: {
        name: "AirPods Pro",
        modelName: "A3047",
        purchaseDate: new Date("2026-01-15T00:00:00.000Z"),
        purchasePrice: 249000,
        storeName: "Apple Store",
        // Deliberately shaped like future/accidental private fields; the filter must ignore them.
        address: forbiddenValues[0],
        phone: forbiddenValues[1],
        orderNumber: forbiddenValues[2],
        cardData: forbiddenValues[3],
      } as never,
      components: [
        { name: "본체", isPresent: true },
        { name: "충전 케이블", isPresent: true },
        { name: "박스", isPresent: false },
      ],
      maintenance: [{ type: "REPAIR" }, { type: "NOTE" }],
      documents: [
        {
          type: "RECEIPT",
          storageKey: forbiddenValues[4],
          rawReceiptText: `${forbiddenValues[0]} ${forbiddenValues[1]} ${forbiddenValues[2]} ${forbiddenValues[3]}`,
        } as never,
      ],
      draft: {
        conditionGrade: "GOOD",
        askingPrice: 170000,
      },
      now: new Date("2026-08-15T00:00:00.000Z"),
    });

    const text = generateResaleText(input);

    expect(text).toContain("AirPods Pro");
    expect(text).toContain("A3047");
    expect(text).toContain("2026년 1월");
    expect(text).toContain("약 7개월");
    expect(text).toContain("상태: 좋음");
    expect(text).toContain("구성품: 2/3");
    expect(text).toContain("수리 이력: 있음");
    expect(text).toContain("구매 증빙: 있음");
    expect(text).toContain("희망 가격: 170,000원");

    for (const forbidden of forbiddenValues) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("omits optional model and asking price instead of inventing data", () => {
    const text = generateResaleText({
      productName: "키보드",
      purchaseYearMonth: "2026년 6월",
      approximateUsePeriod: "약 2개월",
      conditionLabel: "보통",
      componentSummary: "1/1",
      hasRepairHistory: false,
      hasPurchaseProof: false,
    });

    expect(text).toContain("키보드");
    expect(text).toContain("수리 이력: 없음");
    expect(text).toContain("구매 증빙: 없음");
    expect(text).not.toContain("모델:");
    expect(text).not.toContain("희망 가격:");
  });
});
