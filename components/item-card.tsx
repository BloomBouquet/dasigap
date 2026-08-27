import Link from "next/link";

export type ItemCardItem = {
  id: string;
  name: string;
  category: string;
  brand: string | null;
  purchasePrice: number;
  status: string;
};

function formatWon(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    PURCHASED: "구매 완료",
    RETURNABLE: "반품 가능",
    OWNED: "보유 중",
    SELL_PREPARING: "판매 준비",
    LISTED_EXTERNALLY: "판매 등록",
    SOLD: "판매 완료",
  };

  return labels[status] ?? "보유 중";
}

export function ItemCard({ item }: { item: ItemCardItem }) {
  return (
    <Link className="item-card" href={`/items/${item.id}`}>
      <div className="item-card-top">
        <div>
          <h2 className="item-card-title">{item.name}</h2>
          <p className="item-card-meta">
            {[item.brand, item.category].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className="status-badge">{statusLabel(item.status)}</span>
      </div>
      <p className="item-card-price">{formatWon(item.purchasePrice)}</p>
    </Link>
  );
}
