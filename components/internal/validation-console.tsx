"use client";

import { useEffect, useState } from "react";

type ValidationMetrics = {
  firstItem: {
    startedUsers: number;
    completedUsers: number;
    conversionRate: number;
  };
  registrationDuration: {
    sampleSize: number;
    medianMs: number | null;
  };
  retention: {
    d7EligibleUsers: number;
    d7Users: number;
    d7Rate: number;
    d30EligibleUsers: number;
    d30Users: number;
    d30Rate: number;
  };
  resaleCompletion: {
    startedItems: number;
    completedItems: number;
    conversionRate: number;
  };
  copyUsage: {
    completedItems: number;
    copiedItems: number;
    conversionRate: number;
  };
  saleCompletion: {
    startedItems: number;
    soldItems: number;
    conversionRate: number;
  };
  lifecycle: {
    updates: number;
    uniqueUsers: number;
    uniqueItems: number;
  };
  usageCost: {
    views: number;
    uniqueUsers: number;
  };
};

type ValidationResponse = {
  generatedAt: string;
  retentionDays: number;
  metrics: ValidationMetrics;
};

type ValidationState =
  | { status: "loading" }
  | { status: "ready"; data: ValidationResponse }
  | { status: "forbidden" }
  | { status: "not-configured" }
  | { status: "error" };

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function duration(ms: number | null) {
  if (ms === null) return "표본 없음";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <section className="validation-card">
      <p className="validation-label">{label}</p>
      <p className="validation-value">{value}</p>
      <p className="validation-detail">{detail}</p>
    </section>
  );
}

export function ValidationConsole() {
  const [state, setState] = useState<ValidationState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch("/api/internal/validation", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (response.status === 403) {
          setState({ status: "forbidden" });
          return;
        }
        if (response.status === 503) {
          setState({ status: "not-configured" });
          return;
        }
        if (!response.ok) {
          setState({ status: "error" });
          return;
        }

        setState({ status: "ready", data: (await response.json()) as ValidationResponse });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error" });
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  if (state.status === "loading") {
    return (
      <main className="mobile-shell validation-console">
        <section className="status-card">검증 지표를 불러오는 중...</section>
      </main>
    );
  }

  if (state.status === "forbidden") {
    return (
      <main className="mobile-shell validation-console">
        <section className="status-card">
          <h1>접근 권한이 없습니다.</h1>
          <p>허용된 운영자만 제품 검증 지표를 확인할 수 있습니다.</p>
        </section>
      </main>
    );
  }

  if (state.status === "not-configured") {
    return (
      <main className="mobile-shell validation-console">
        <section className="status-card">
          <h1>검증 콘솔 설정이 완료되지 않았습니다.</h1>
        </section>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="mobile-shell validation-console">
        <section className="status-card">
          <h1>검증 지표를 불러오지 못했습니다.</h1>
          <button className="primary-button" type="button" onClick={() => window.location.reload()}>
            다시 시도
          </button>
        </section>
      </main>
    );
  }

  const { data } = state;
  const { metrics } = data;

  return (
    <main className="mobile-shell validation-console">
      <header className="validation-header">
        <div>
          <p className="eyebrow">INTERNAL · AGGREGATES ONLY</p>
          <h1 className="page-title">Validation Ops</h1>
          <p className="page-description">
            개인 식별 정보 없이 제품 검증 퍼널과 재방문 신호만 확인합니다.
          </p>
        </div>
        <div className="validation-meta">
          <span>Raw retention {data.retentionDays}일</span>
          <span>{new Date(data.generatedAt).toLocaleString("ko-KR")}</span>
        </div>
      </header>

      <section className="validation-section" aria-labelledby="validation-registration">
        <h2 id="validation-registration">첫 물건 등록</h2>
        <div className="validation-grid">
          <MetricCard
            label="등록 완료율"
            value={percent(metrics.firstItem.conversionRate)}
            detail={`${metrics.firstItem.completedUsers}/${metrics.firstItem.startedUsers}명 완료`}
          />
          <MetricCard
            label="중앙 등록 시간"
            value={duration(metrics.registrationDuration.medianMs)}
            detail={`유효 표본 ${metrics.registrationDuration.sampleSize}건`}
          />
        </div>
      </section>

      <section className="validation-section" aria-labelledby="validation-retention">
        <h2 id="validation-retention">재방문</h2>
        <div className="validation-grid">
          <MetricCard
            label="D7 재방문"
            value={percent(metrics.retention.d7Rate)}
            detail={`${metrics.retention.d7Users}/${metrics.retention.d7EligibleUsers}명`}
          />
          <MetricCard
            label="D30 재방문"
            value={percent(metrics.retention.d30Rate)}
            detail={`${metrics.retention.d30Users}/${metrics.retention.d30EligibleUsers}명`}
          />
        </div>
      </section>

      <section className="validation-section" aria-labelledby="validation-lifecycle">
        <h2 id="validation-lifecycle">생애관리 사용</h2>
        <div className="validation-grid">
          <MetricCard
            label="생애관리 업데이트"
            value={`${metrics.lifecycle.updates}건`}
            detail={`${metrics.lifecycle.uniqueUsers}명 · ${metrics.lifecycle.uniqueItems}개 물건`}
          />
          <MetricCard
            label="사용비 조회"
            value={`${metrics.usageCost.views}회`}
            detail={`${metrics.usageCost.uniqueUsers}명 사용`}
          />
        </div>
      </section>

      <section className="validation-section" aria-labelledby="validation-resale">
        <h2 id="validation-resale">판매 준비 퍼널</h2>
        <div className="validation-grid">
          <MetricCard
            label="판매 준비 완료"
            value={percent(metrics.resaleCompletion.conversionRate)}
            detail={`${metrics.resaleCompletion.completedItems}/${metrics.resaleCompletion.startedItems}개`}
          />
          <MetricCard
            label="판매글 복사"
            value={percent(metrics.copyUsage.conversionRate)}
            detail={`${metrics.copyUsage.copiedItems}/${metrics.copyUsage.completedItems}개`}
          />
          <MetricCard
            label="실제 판매 완료"
            value={percent(metrics.saleCompletion.conversionRate)}
            detail={`${metrics.saleCompletion.soldItems}/${metrics.saleCompletion.startedItems}개`}
          />
        </div>
      </section>
    </main>
  );
}
