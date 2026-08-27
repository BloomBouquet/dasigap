"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type ComponentItem = { id: string; name: string; isPresent: boolean };

export function ComponentChecklist({ itemId }: { itemId: string }) {
  const [items, setItems] = useState<ComponentItem[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/items/${itemId}/components`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "구성품을 불러오지 못했습니다.");
      setItems(body.components);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "구성품을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    const response = await fetch(`/api/items/${itemId}/components`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message ?? "구성품을 추가하지 못했습니다.");
      return;
    }
    setName("");
    setItems((current) => [...current, body.component].sort((a, b) => a.name.localeCompare(b.name, "ko")));
  }

  async function toggle(component: ComponentItem) {
    const next = !component.isPresent;
    setItems((current) => current.map((item) => (item.id === component.id ? { ...item, isPresent: next } : item)));
    const response = await fetch(`/api/items/${itemId}/components`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: component.id, isPresent: next }),
    });
    if (!response.ok) {
      setItems((current) =>
        current.map((item) => (item.id === component.id ? { ...item, isPresent: component.isPresent } : item)),
      );
      setError("구성품 상태를 저장하지 못했습니다.");
    }
  }

  return (
    <section className="section-card">
      <div className="section-card-header">
        <h2>구성품</h2>
        <span className="status-badge">{items.filter((item) => item.isPresent).length}/{items.length}</span>
      </div>
      <p>판매 전 박스, 케이블, 설명서처럼 함께 넘길 구성품을 확인합니다.</p>
      {loading ? <p className="subtle-text">불러오는 중...</p> : null}
      {error ? <p className="field-error">{error}</p> : null}
      <div className="checklist" aria-label="구성품 체크리스트">
        {items.map((component) => (
          <label className="checklist-row" key={component.id}>
            <input
              type="checkbox"
              checked={component.isPresent}
              onChange={() => void toggle(component)}
            />
            <span>{component.name}</span>
          </label>
        ))}
      </div>
      <form className="inline-form" onSubmit={add}>
        <label className="field" htmlFor="component-name">
          <span className="field-label">구성품 추가</span>
          <input
            id="component-name"
            value={name}
            maxLength={120}
            placeholder="예: 충전 케이블"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button className="secondary-button" type="submit">추가</button>
      </form>
    </section>
  );
}
