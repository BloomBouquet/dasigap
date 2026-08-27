"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ItemCard, type ItemCardItem } from "../../../components/item-card";

type ListState =
  | { status: "loading" }
  | { status: "ready"; items: ItemCardItem[] }
  | { status: "error"; message: string };

export default function ItemsPage() {
  const [state, setState] = useState<ListState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function loadItems() {
      try {
        const response = await fetch("/api/items", {
          signal: controller.signal,
          cache: "no-store",
        });
        const body = await response.json();

        if (!response.ok) {
          setState({
            status: "error",
            message: body?.error?.message ?? "물건 목록을 불러오지 못했습니다.",
          });
          return;
        }

        setState({ status: "ready", items: body.items });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setState({ status: "error", message: "네트워크 연결을 확인해주세요." });
      }
    }

    void loadItems();
    return () => controller.abort();
  }, []);

  return (
    <main className="mobile-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">MY ITEMS</p>
          <h1 className="page-title">내 물건</h1>
          <p className="page-description">구매 이후의 기록을 한 곳에서 이어서 관리하세요.</p>
        </div>
        <Link className="primary-link" href="/items/new">
          + 등록
        </Link>
      </header>

      {state.status === "loading" ? (
        <section className="status-card" aria-label="물건 목록 불러오는 중">
          <div className="loading-line" />
          <div className="loading-line short" />
        </section>
      ) : null}

      {state.status === "error" ? (
        <section className="status-card">
          <h2>목록을 불러오지 못했어요</h2>
          <p>{state.message}</p>
        </section>
      ) : null}

      {state.status === "ready" && state.items.length === 0 ? (
        <section className="empty-card">
          <h2>아직 등록한 물건이 없어요</h2>
          <p>첫 물건을 등록하면 구매일과 가격부터 생애 기록이 시작됩니다.</p>
          <Link className="primary-link" href="/items/new">
            첫 물건 등록하기
          </Link>
        </section>
      ) : null}

      {state.status === "ready" && state.items.length > 0 ? (
        <section className="item-list" aria-label="등록한 물건">
          {state.items.map((item) => (
            <ItemCard item={item} key={item.id} />
          ))}
        </section>
      ) : null}
    </main>
  );
}
