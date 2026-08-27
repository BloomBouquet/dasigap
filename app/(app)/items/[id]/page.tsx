"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

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

type DetailState =
  | { status: "loading" }
  | { status: "ready"; item: ItemDetail }
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

function Section({ title, description }: { title: string; description: string }) {
  return (
    <section className="section-card">
      <div className="section-card-header">
        <h2>{title}</h2>
        <span className="status-badge">준비 중</span>
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
        const response = await fetch(`/api/items/${params.id}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json();

        if (!response.ok) {
          setState({
            status: "error",
            message: body?.error?.message ?? "물건 정보를 불러오지 못했습니다.",
          });
          return;
        }

        setState({ status: "ready", item: body.item });
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
          <div>
            <p className="eyebrow">ITEM DETAIL</p>
            <h1 className="page-title">불러오는 중</h1>
          </div>
          <Link className="back-link" href="/items">
            목록
          </Link>
        </header>
        <section className="status-card" aria-label="물건 상세 불러오는 중">
          <div className="loading-line" />
          <div className="loading-line short" />
        </section>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="mobile-shell">
        <header className="page-header">
          <div>
            <p className="eyebrow">ITEM DETAIL</p>
            <h1 className="page-title">찾을 수 없어요</h1>
          </div>
          <Link className="back-link" href="/items">
            목록
          </Link>
        </header>
        <section className="status-card">
          <p>{state.message}</p>
        </section>
      </main>
    );
  }

  const { item } = state;

  return (
    <main className="mobile-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">ITEM DETAIL</p>
        </div>
        <Link className="back-link" href="/items">
          목록
        </Link>
      </header>

      <section className="detail-hero">
        <span className="status-badge">보유 기록</span>
        <h1>{item.name}</h1>
        <p className="detail-price">{won(item.purchasePrice)}</p>
        <p className="detail-subtitle">
          {[item.brand, item.modelName, item.category].filter(Boolean).join(" · ")}
        </p>

        <div className="info-list">
          <div className="info-row">
            <span className="info-label">구매일</span>
            <span className="info-value">{dateLabel(item.purchaseDate)}</span>
          </div>
          <div className="info-row">
            <span className="info-label">구매처</span>
            <span className="info-value">{item.storeName ?? "미입력"}</span>
          </div>
        </div>
      </section>

      <div className="detail-grid">
        <Section title="반품 · 보증" description="반품 마감일과 보증기간을 이곳에서 관리합니다." />
        <Section title="구성품" description="박스, 충전기, 영수증 등 판매할 때 필요한 구성품을 기록합니다." />
        <Section title="수리 · 상태 기록" description="수리, 교체, 흠집과 상태 변화를 시간순으로 남깁니다." />
        <Section title="문서" description="영수증과 보증 문서는 비공개 저장소에서 안전하게 관리합니다." />
        <Section title="판매 준비" description="상태와 구성품을 점검하고 판매글 초안을 준비합니다." />
        <Section title="판매 기록" description="판매가를 기록하면 실제 사용비를 자동으로 계산합니다." />
      </div>
    </main>
  );
}
