"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { AppVisitTracker } from "./analytics/app-visit-tracker";
import { BottomNav } from "./bottom-nav";

type SessionState =
  | { status: "checking" }
  | { status: "anonymous" }
  | { status: "authenticated"; userId: string }
  | { status: "error" };

function LegalLinks() {
  return (
    <footer className="legal-footer">
      <Link href="/privacy">개인정보처리방침</Link>
      <Link href="/terms">이용약관</Link>
    </footer>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPublicLegalPage = pathname === "/privacy" || pathname === "/terms";
  const isInternalPage = pathname.startsWith("/internal/");
  const returnTo = isPublicLegalPage ? "/" : pathname;
  const loginHref = `/auth/bouquet/start?returnTo=${encodeURIComponent(returnTo)}`;
  const [session, setSession] = useState<SessionState>({ status: "checking" });

  useEffect(() => {
    if (isPublicLegalPage) return;

    const controller = new AbortController();
    fetch("/auth/session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("session_check_failed");
        return response.json() as Promise<{ user: { userId: string } | null }>;
      })
      .then((body) => {
        setSession(body.user
          ? { status: "authenticated", userId: body.user.userId }
          : { status: "anonymous" });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSession({ status: "error" });
      });
    return () => controller.abort();
  }, [isPublicLegalPage]);

  async function signOut() {
    const response = await fetch("/auth/sign-out", { method: "POST" });
    if (response.ok) setSession({ status: "anonymous" });
  }

  if (isPublicLegalPage) {
    return (
      <div className="app-shell">
        <div className="app-shell-content">{children}</div>
        <LegalLinks />
      </div>
    );
  }

  if (session.status === "checking") {
    return <main className="mobile-shell"><section className="status-card">로그인 상태를 확인하는 중...</section></main>;
  }

  if (session.status === "anonymous") {
    return (
      <div className={isInternalPage ? "app-shell internal-app-shell" : "app-shell"}>
        <main className="mobile-shell">
          <section className="status-card">
            <p className="eyebrow">BOUQUET SSO</p>
            <h1 className="page-title">꽃다발 로그인이 필요해요</h1>
            <p className="page-description">다시값은 꽃다발 공통 계정으로 로그인합니다. 비밀번호는 다시값에 전달되지 않습니다.</p>
            <a className="primary-link" href={loginHref}>꽃다발로 로그인</a>
          </section>
        </main>
        <LegalLinks />
      </div>
    );
  }

  if (session.status === "error") {
    return (
      <main className="mobile-shell">
        <section className="status-card">
          <h1 className="page-title">로그인 상태를 확인하지 못했어요</h1>
          <button className="primary-button" type="button" onClick={() => window.location.reload()}>다시 시도</button>
        </section>
      </main>
    );
  }

  return (
    <div className={isInternalPage ? "app-shell internal-app-shell" : "app-shell"}>
      {!isInternalPage && <AppVisitTracker />}
      <div className="app-shell-content">{children}</div>
      <footer className="legal-footer">
        <Link href="/privacy">개인정보처리방침</Link>
        <Link href="/terms">이용약관</Link>
        <button type="button" onClick={signOut}>로그아웃</button>
      </footer>
      {!isInternalPage && <BottomNav />}
    </div>
  );
}
