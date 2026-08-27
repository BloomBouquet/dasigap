import type { ResaleTemplateInput } from "./privacy-filter";

function formatKrw(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

export function generateResaleText(input: ResaleTemplateInput): string {
  const lines = [
    `상품: ${input.productName}`,
    ...(input.modelName ? [`모델: ${input.modelName}`] : []),
    `구매 시기: ${input.purchaseYearMonth}`,
    `사용 기간: ${input.approximateUsePeriod}`,
    `상태: ${input.conditionLabel}`,
    `구성품: ${input.componentSummary}`,
    `수리 이력: ${input.hasRepairHistory ? "있음" : "없음"}`,
    `구매 증빙: ${input.hasPurchaseProof ? "있음" : "없음"}`,
    ...(input.askingPrice ? [`희망 가격: ${formatKrw(input.askingPrice)}`] : []),
  ];

  return lines.join("\n");
}
