"use client";

import { useEffect, useState } from "react";

import {
  UsageCostCard,
  type UsageCostItem,
} from "../../../components/usage-cost-card";

type ReportState =
  | { status: "loading" }
  | {
      status: "ready";
      items: UsageCostItem[];
      summary: {
        totalPurchasePrice: number;
        totalRecoveredAmount: number;
        netUsageCost: number;
      };
    }
  | { status: "error"; message: string };

function krw(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(Math.abs(value))}원`;
}

export default function ReportPage() {
  const [state, setState] = useState<ReportState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function loadReport() {
      try {
        const response = await fetch("/api/report", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) {
          setState({
            status: "error",
            message: body?.error?.message ?? "리포트를 불러오지 못했습니다.",
          });
          return;
        }
        setState({ status: "ready", items: body.items, summary: body.summary });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setState({ status: "error", message: "네트워크 연결을 확인해주세요." });
      }
    }

    void loadReport();
    return () => controller.abort();
  }, []);

  return (
    <main className="mobile-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">REPORT</p>
          <h1 className="page-title">사용비 리포트</h1>
          <p className="page-description">
            판매가 끝난 물건의 구매가와 회수 금액을 기준으로 실제 사용비를 확인하세요.
          </p>
        </div>
      </header>

      {state.status === "loading" ? (
        <section className="status-card" aria-label="리포트 불러오는 중">
          <div className="loading-line" />
          <div className="loading-line short" />
        </section>
      ) : null}

      {state.status === "error" ? (
        <section className="status-card">
          <h2>리포트를 불러오지 못했어요</h2>
          <p>{state.message}</p>
        </section>
      ) : null}

      {state.status === "ready" ? (
        <>
          <section className="section-card" aria-label="판매 요약">
            <h2>누적 요약</h2>
            <div className="info-list">
              <div className="info-row">
                <span className="info-label">구매가 합계</span>
                <strong className="info-value">{krw(state.summary.totalPurchasePrice)}</strong>
              </div>
              <div className="info-row">
                <span className="info-label">판매 회수액</span>
                <strong className="info-value">{krw(state.summary.totalRecoveredAmount)}</strong>
              </div>
              <div className="info-row">
                <span className="info-label">
                  {state.summary.netUsageCost < 0 ? "누적 판매 차익" : "누적 실질 사용비"}
                </span>
                <strong className="info-value">{krw(state.summary.netUsageCost)}</strong>
              </div>
            </div>
          </section>

          <div className="detail-grid">
            {state.items.length === 0 ? (
              <section className="empty-card">
                <h2>아직 판매 완료 기록이 없어요</h2>
                <p>외부 거래가 끝난 물건의 판매가를 기록하면 사용비가 계산됩니다.</p>
              </section>
            ) : (
              state.items.map((item) => <UsageCostCard item={item} key={item.itemId} />)
            )}
          </div>
        </>
      ) : null}
    </main>
  );
}
