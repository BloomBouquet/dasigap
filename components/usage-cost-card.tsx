export type UsageCostItem = {
  itemId: string;
  name: string;
  purchasePrice: number;
  soldPrice: number;
  usageCost: number;
  monthlyUsageCost: number;
  ownershipDays: number;
  kind: "COST" | "BREAK_EVEN" | "PROFIT";
};

function krw(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(Math.abs(value))}원`;
}

export function UsageCostCard({ item }: { item: UsageCostItem }) {
  const primaryLabel = item.kind === "PROFIT" ? "판매 차익" : "실질 사용비";
  const primaryValue = item.kind === "BREAK_EVEN" ? "0원" : krw(item.usageCost);

  return (
    <article className="section-card">
      <div className="section-card-header">
        <div>
          <p className="eyebrow">SOLD</p>
          <h2>{item.name}</h2>
        </div>
        <span className="status-badge">{item.ownershipDays}일 보유</span>
      </div>

      <div className="info-list">
        <div className="info-row">
          <span className="info-label">구매가</span>
          <strong className="info-value">{krw(item.purchasePrice)}</strong>
        </div>
        <div className="info-row">
          <span className="info-label">판매가</span>
          <strong className="info-value">{krw(item.soldPrice)}</strong>
        </div>
        <div className="info-row">
          <span className="info-label">{primaryLabel}</span>
          <strong className="info-value">{primaryValue}</strong>
        </div>
        {item.kind !== "PROFIT" ? (
          <div className="info-row">
            <span className="info-label">월 평균 사용비</span>
            <strong className="info-value">{krw(item.monthlyUsageCost)}</strong>
          </div>
        ) : null}
      </div>
    </article>
  );
}
