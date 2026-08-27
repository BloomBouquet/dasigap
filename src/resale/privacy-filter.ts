const DAYS_PER_MONTH = 30.4375;

export type ResaleTemplateInput = {
  productName: string;
  modelName?: string;
  purchaseYearMonth: string;
  approximateUsePeriod: string;
  conditionLabel: string;
  componentSummary: string;
  hasRepairHistory: boolean;
  hasPurchaseProof: boolean;
  askingPrice?: number;
};

type ResaleTemplateSource = {
  item: {
    name: string;
    modelName?: string | null;
    purchaseDate: Date;
  };
  components: Array<{ name: string; isPresent: boolean }>;
  maintenance: Array<{ type: string }>;
  documents: Array<{ type: string }>;
  draft: {
    conditionGrade: string;
    askingPrice?: number | null;
  };
  now?: Date;
};

const CONDITION_LABELS: Record<string, string> = {
  LIKE_NEW: "거의 새것",
  GOOD: "좋음",
  FAIR: "보통",
  WORN: "사용감 있음",
};

function formatYearMonth(date: Date) {
  return `${date.getUTCFullYear()}년 ${date.getUTCMonth() + 1}월`;
}

function approximateUsePeriod(purchaseDate: Date, now: Date) {
  const days = Math.max(1, Math.round((now.getTime() - purchaseDate.getTime()) / 86_400_000));
  if (days < 30) return `약 ${days}일`;
  const months = Math.max(1, Math.round(days / DAYS_PER_MONTH));
  if (months < 12) return `약 ${months}개월`;
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  return remainingMonths > 0 ? `약 ${years}년 ${remainingMonths}개월` : `약 ${years}년`;
}

export function buildResaleTemplateInput(source: ResaleTemplateSource): ResaleTemplateInput {
  const now = source.now ?? new Date();
  const totalComponents = source.components.length;
  const presentComponents = source.components.filter((component) => component.isPresent).length;

  return {
    productName: source.item.name,
    ...(source.item.modelName ? { modelName: source.item.modelName } : {}),
    purchaseYearMonth: formatYearMonth(source.item.purchaseDate),
    approximateUsePeriod: approximateUsePeriod(source.item.purchaseDate, now),
    conditionLabel: CONDITION_LABELS[source.draft.conditionGrade] ?? "확인 필요",
    componentSummary: `${presentComponents}/${totalComponents}`,
    hasRepairHistory: source.maintenance.some((record) =>
      record.type === "REPAIR" || record.type === "REPLACEMENT",
    ),
    hasPurchaseProof: source.documents.some((document) => document.type === "RECEIPT"),
    ...(source.draft.askingPrice ? { askingPrice: source.draft.askingPrice } : {}),
  };
}
