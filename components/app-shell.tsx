import Link from "next/link";
import type { ReactNode } from "react";

import { AppVisitTracker } from "./analytics/app-visit-tracker";
import { BottomNav } from "./bottom-nav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <AppVisitTracker />
      <div className="app-shell-content">{children}</div>
      <footer className="legal-footer">
        <Link href="/privacy">개인정보처리방침</Link>
        <Link href="/terms">이용약관</Link>
      </footer>
      <BottomNav />
    </div>
  );
}
