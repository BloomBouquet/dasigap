"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type MaintenanceType = "REPAIR" | "REPLACEMENT" | "DAMAGE" | "CONDITION" | "NOTE";
type MaintenanceItem = {
  id: string;
  type: MaintenanceType;
  occurredAt: string;
  note: string | null;
};

const labels: Record<MaintenanceType, string> = {
  REPAIR: "수리",
  REPLACEMENT: "부품 교체",
  DAMAGE: "흠집/파손",
  CONDITION: "상태 메모",
  NOTE: "기타 메모",
};

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function MaintenanceList({ itemId }: { itemId: string }) {
  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [type, setType] = useState<MaintenanceType>("CONDITION");
  const [occurredAt, setOccurredAt] = useState(today());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/items/${itemId}/maintenance`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "상태 기록을 불러오지 못했습니다.");
      setItems(body.maintenance);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "상태 기록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch(`/api/items/${itemId}/maintenance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, occurredAt, note }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message ?? "상태 기록을 저장하지 못했습니다.");
      return;
    }
    setNote("");
    setItems((current) => [body.maintenance, ...current]);
    setError(null);
  }

  return (
    <section className="section-card">
      <div className="section-card-header">
        <h2>상태 · 수리 이력</h2>
        <span className="status-badge">{items.length}건</span>
      </div>
      <p>수리, 교체, 흠집과 상태 변화를 날짜 기준으로 남깁니다.</p>
      {loading ? <p className="subtle-text">불러오는 중...</p> : null}
      {error ? <p className="field-error">{error}</p> : null}
      <div className="history-list">
        {items.map((item) => (
          <article className="history-row" key={item.id}>
            <div>
              <strong>{labels[item.type]}</strong>
              <span>{item.occurredAt}</span>
            </div>
            {item.note ? <p>{item.note}</p> : null}
          </article>
        ))}
      </div>
      <form className="stack-form" onSubmit={add}>
        <div className="form-two-column">
          <label className="field" htmlFor="maintenance-type">
            <span className="field-label">기록 종류</span>
            <select id="maintenance-type" value={type} onChange={(event) => setType(event.target.value as MaintenanceType)}>
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="field" htmlFor="maintenance-date">
            <span className="field-label">날짜</span>
            <input id="maintenance-date" type="date" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} />
          </label>
        </div>
        <label className="field" htmlFor="maintenance-note">
          <span className="field-label">설명 <span className="field-hint">선택</span></span>
          <textarea id="maintenance-note" value={note} maxLength={1000} placeholder="예: 오른쪽 케이스에 작은 흠집" onChange={(event) => setNote(event.target.value)} />
        </label>
        <button className="secondary-button" type="submit">기록 추가</button>
      </form>
    </section>
  );
}
