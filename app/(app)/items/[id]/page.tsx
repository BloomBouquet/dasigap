"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { ComponentChecklist } from "../../../../components/component-checklist";
import { DdayBadge } from "../../../../components/dday-badge";
import { MaintenanceList } from "../../../../components/maintenance-list";

type ItemDetail = {
  id: string;
  name: string;
  category: string;
  brand: string | null;
  modelName: string | null;
  storeName: string | null;
  purchaseDate: string;
  purchasePrice: number;
  currency: "KRW";
  status: string;
};

type LifecycleDetail = {
  returnDeadline: string | null;
  warranty: { startsAt: string; endsAt: string | null } | null;
};

type DetailState =
  | { status: "loading" }
  | { status: "ready"; item: ItemDetail; lifecycle: LifecycleDetail }
  | { status: "error"; message: string };

function won(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function LifecyclePanel({ itemId, initial }: { itemId: string; initial: LifecycleDetail }) {
  const [returnDeadline, setReturnDeadline] = useState(initial.returnDeadline ?? "");
  const [warrantyStartsAt, setWarrantyStartsAt] = useState(initial.warranty?.startsAt ?? "");
  const [warrantyEndsAt, setWarrantyEndsAt] = useState(initial.warranty?.endsAt ?? "");
  const [saved, setSaved] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/items/${itemId}/lifecycle`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          returnDeadline: returnDeadline || null,
          warrantyStartsAt: warrantyStartsAt || null,
          warrantyEndsAt: warrantyEndsAt || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body?.error?.message ?? "기간 정보를 저장하지 못했습니다.");
        return;
      }
      setSaved(body.lifecycle);
      setMessage("저장했습니다.");
    } catch {
      setMessage("네트워크 연결을 확인해주세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="section-card">
      <div className="section-card-header">
        <h2>구매 · 반품 · 보증</h2>
      </div>
      <div className="deadline-grid">
        <div className="deadline-row">
          <div>
            <strong>입력한 반품기간 기준</strong>
            <span>{saved.returnDeadline ?? "반품 마감일 미입력"}</span>
          </div>
          <DdayBadge label="입력한 반품기간 기준" date={saved.returnDeadline} />
        </div>
        <div className="deadline-row">
          <div>
            <strong>등록 정보 기준 예상 보증기간</strong>
            <span>{saved.warranty?.endsAt ?? "보증 종료일 미입력"}</span>
          </div>
          <DdayBadge label="등록 정보 기준 예상 보증기간" date={saved.warranty?.endsAt ?? null} />
        </div>
      </div>
      <p className="legal-copy">실제 반품·보증 정책은 판매처와 제조사 기준을 확인해주세요.</p>
      <form className="stack-form" onSubmit={save}>
        <label className="field" htmlFor="return-deadline">
          <span className="field-label">반품 마감일 <span className="field-hint">선택</span></span>
          <input id="return-deadline" type="date" value={returnDeadline} onChange={(event) => setReturnDeadline(event.target.value)} />
        </label>
        <div className="form-two-column">
          <label className="field" htmlFor="warranty-start">
            <span className="field-label">보증 시작일 <span className="field-hint">선택</span></span>
            <input id="warranty-start" type="date" value={warrantyStartsAt} onChange={(event) => setWarrantyStartsAt(event.target.value)} />
          </label>
          <label className="field" htmlFor="warranty-end">
            <span className="field-label">보증 종료일 <span className="field-hint">선택</span></span>
            <input id="warranty-end" type="date" value={warrantyEndsAt} onChange={(event) => setWarrantyEndsAt(event.target.value)} />
          </label>
        </div>
        {message ? <p className="subtle-text" role="status">{message}</p> : null}
        <button className="secondary-button" type="submit" disabled={saving}>{saving ? "저장 중..." : "기간 정보 저장"}</button>
      </form>
    </section>
  );
}

function ReservedSection({ title, description }: { title: string; description: string }) {
  return (
    <section className="section-card">
      <div className="section-card-header">
        <h2>{title}</h2>
        <span className="status-badge status-badge-muted">다음 단계</span>
      </div>
      <p>{description}</p>
    </section>
  );
}

export default function ItemDetailPage() {
  const params = useParams<{ id: string }>();
  const [state, setState] = useState<DetailState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function loadItem() {
      try {
        const [itemResponse, lifecycleResponse] = await Promise.all([
          fetch(`/api/items/${params.id}`, { cache: "no-store", signal: controller.signal }),
          fetch(`/api/items/${params.id}/lifecycle`, { cache: "no-store", signal: controller.signal }),
        ]);
        const itemBody = await itemResponse.json();
        const lifecycleBody = await lifecycleResponse.json();
        if (!itemResponse.ok || !lifecycleResponse.ok) {
          setState({
            status: "error",
            message: itemBody?.error?.message ?? lifecycleBody?.error?.message ?? "물건 정보를 불러오지 못했습니다.",
          });
          return;
        }
        setState({ status: "ready", item: itemBody.item, lifecycle: lifecycleBody.lifecycle });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setState({ status: "error", message: "네트워크 연결을 확인해주세요." });
      }
    }

    if (params.id) void loadItem();
    return () => controller.abort();
  }, [params.id]);

  if (state.status === "loading") {
    return (
      <main className="mobile-shell">
        <header className="page-header">
          <div><p className="eyebrow">ITEM DETAIL</p><h1 className="page-title">불러오는 중</h1></div>
          <Link className="back-link" href="/items">목록</Link>
        </header>
        <section className="status-card" aria-label="물건 상세 불러오는 중"><div className="loading-line" /><div className="loading-line short" /></section>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="mobile-shell">
        <header className="page-header">
          <div><p className="eyebrow">ITEM DETAIL</p><h1 className="page-title">찾을 수 없어요</h1></div>
          <Link className="back-link" href="/items">목록</Link>
        </header>
        <section className="status-card"><p>{state.message}</p></section>
      </main>
    );
  }

  const { item, lifecycle } = state;
  return (
    <main className="mobile-shell">
      <header className="page-header">
        <div><p className="eyebrow">ITEM DETAIL</p></div>
        <Link className="back-link" href="/items">목록</Link>
      </header>

      <section className="detail-hero">
        <span className="status-badge">핵심 상태 · 보유 기록</span>
        <h1>{item.name}</h1>
        <p className="detail-price">{won(item.purchasePrice)}</p>
        <p className="detail-subtitle">{[item.brand, item.modelName, item.category].filter(Boolean).join(" · ")}</p>
        <div className="info-list">
          <div className="info-row"><span className="info-label">구매일</span><span className="info-value">{dateLabel(item.purchaseDate)}</span></div>
          <div className="info-row"><span className="info-label">구매처</span><span className="info-value">{item.storeName ?? "미입력"}</span></div>
        </div>
      </section>

      <div className="detail-grid">
        <LifecyclePanel itemId={item.id} initial={lifecycle} />
        <ComponentChecklist itemId={item.id} />
        <MaintenanceList itemId={item.id} />
        <ReservedSection title="구매 증빙" description="영수증과 보증 문서는 비공개 저장소에서 안전하게 관리합니다." />
        <ReservedSection title="판매 준비" description="상태와 구성품을 점검하고 개인정보 없는 판매글 초안을 준비합니다." />
        <ReservedSection title="판매 기록" description="판매가를 기록하면 실제 사용비를 자동으로 계산합니다." />
      </div>
    </main>
  );
}
