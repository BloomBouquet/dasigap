"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ActionCard, type HomeAction } from "./action-card";

type Item = {
  id: string;
  name: string;
  status: string;
  returnDeadline: string | null;
  createdAt: string;
  updatedAt: string;
};

type Lifecycle = {
  returnDeadline: string | null;
  warranty: { startsAt: string; endsAt: string | null } | null;
};

type HomeState =
  | { status: "loading" }
  | { status: "ready"; actions: HomeAction[] }
  | { status: "error"; message: string };

const DAY_MS = 86_400_000;

function daysUntil(value: string | null) {
  if (!value) return null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const target = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Math.ceil((target - todayUtc) / DAY_MS);
}

function actionFor(item: Item, lifecycle: Lifecycle): HomeAction {
  const returnDays = daysUntil(lifecycle.returnDeadline ?? item.returnDeadline);
  if (returnDays !== null && returnDays >= 0 && returnDays <= 7) {
    return {
      itemId: item.id,
      name: item.name,
      label: "반품 확인",
      description: returnDays === 0 ? "오늘이 입력한 반품 마감일입니다." : `입력한 반품 마감일까지 ${returnDays}일 남았습니다.`,
      href: `/items/${item.id}`,
      priority: 1,
      sortAt: lifecycle.returnDeadline ?? item.returnDeadline ?? item.updatedAt,
    };
  }

  const warrantyDays = daysUntil(lifecycle.warranty?.endsAt ?? null);
  if (warrantyDays !== null && warrantyDays >= 0 && warrantyDays <= 30) {
    return {
      itemId: item.id,
      name: item.name,
      label: "보증 확인",
      description: `등록 정보 기준 예상 보증 종료일까지 ${warrantyDays}일 남았습니다.`,
      href: `/items/${item.id}`,
      priority: 2,
      sortAt: lifecycle.warranty?.endsAt ?? item.updatedAt,
    };
  }

  if (item.status === "SELL_PREPARING" || item.status === "LISTED_EXTERNALLY") {
    return {
      itemId: item.id,
      name: item.name,
      label: "판매 준비 이어가기",
      description: "상태와 구성품을 확인하고 안전한 판매글 초안을 완성하세요.",
      href: `/items/${item.id}/resale`,
      priority: 3,
      sortAt: item.updatedAt,
    };
  }

  if (item.status === "SOLD") {
    return {
      itemId: item.id,
      name: item.name,
      label: "최근 판매",
      description: "판매 회수액과 실질 사용비를 리포트에서 확인하세요.",
      href: "/report",
      priority: 5,
      sortAt: item.updatedAt,
    };
  }

  return {
    itemId: item.id,
    name: item.name,
    label: "최근 등록",
    description: "구매 기록과 구성품, 보증 정보를 이어서 관리하세요.",
    href: `/items/${item.id}`,
    priority: 4,
    sortAt: item.createdAt,
  };
}

export function HomeDashboard() {
  const [state, setState] = useState<HomeState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const itemsResponse = await fetch("/api/items", { cache: "no-store", signal: controller.signal });
        const itemsBody = await itemsResponse.json();
        if (!itemsResponse.ok) {
          setState({ status: "error", message: itemsBody?.error?.message ?? "홈 정보를 불러오지 못했습니다." });
          return;
        }

        const items = itemsBody.items as Item[];
        const lifecycles = await Promise.all(
          items.map(async (item) => {
            const response = await fetch(`/api/items/${item.id}/lifecycle`, {
              cache: "no-store",
              signal: controller.signal,
            });
            if (!response.ok) return { returnDeadline: item.returnDeadline, warranty: null } satisfies Lifecycle;
            const body = await response.json();
            return body.lifecycle as Lifecycle;
          }),
        );

        const actions = items
          .map((item, index) => actionFor(item, lifecycles[index]))
          .sort((a, b) => a.priority - b.priority || Date.parse(b.sortAt) - Date.parse(a.sortAt));

        setState({ status: "ready", actions });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setState({ status: "error", message: "네트워크 연결을 확인해주세요." });
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  if (state.status === "loading") {
    return (
      <main className="mobile-shell home-shell" aria-label="홈 불러오는 중">
        <section className="status-card"><div className="loading-line" /><div className="loading-line short" /></section>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="mobile-shell home-shell">
        <section className="status-card"><h1>홈을 불러오지 못했어요</h1><p>{state.message}</p></section>
      </main>
    );
  }

  return (
    <main className="mobile-shell home-shell">
      <header className="home-hero">
        <div>
          <p className="eyebrow">DASIGAP</p>
          <h1 className="page-title">다시값</h1>
          <p className="page-description">산 물건을 다시 팔 때까지, 지금 필요한 관리부터 보여드립니다.</p>
        </div>
        <Link className="primary-link" href="/items/new">+ 등록</Link>
      </header>

      <section className="home-section" aria-labelledby="home-actions-title">
        <div className="home-section-heading">
          <div><p className="eyebrow">NEXT ACTION</p><h2 id="home-actions-title">지금 할 일</h2></div>
          <Link href="/items">전체 물건</Link>
        </div>
        {state.actions.length > 0 ? (
          <div className="action-list">
            {state.actions.map((action) => <ActionCard action={action} key={action.itemId} />)}
          </div>
        ) : (
          <section className="empty-card">
            <h3>아직 관리할 물건이 없어요</h3>
            <p>첫 물건을 등록하면 반품, 보증, 판매 준비 순서로 필요한 일을 정리해드립니다.</p>
            <Link className="primary-link" href="/items/new">첫 물건 등록하기</Link>
          </section>
        )}
      </section>
    </main>
  );
}
