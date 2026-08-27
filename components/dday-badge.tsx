"use client";

import { calendarDateDifference } from "../src/items/lifecycle";

function localToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DdayBadge({ label, date }: { label: string; date: string | null }) {
  if (!date) return <span className="status-badge status-badge-muted">미입력</span>;

  const difference = calendarDateDifference(date, localToday());
  const value = difference > 0 ? `D-${difference}` : difference === 0 ? "D-DAY" : `D+${Math.abs(difference)}`;

  return (
    <span className={`status-badge ${difference < 0 ? "status-badge-muted" : ""}`} aria-label={`${label} ${value}`}>
      {value}
    </span>
  );
}
