"use client";

import { useEffect, useRef } from "react";

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function AppVisitTracker() {
  const trackedRef = useRef(false);

  useEffect(() => {
    if (trackedRef.current) return;
    trackedRef.current = true;

    const storageKey = `dasigap:app-visited:${localDateKey(new Date())}`;

    try {
      if (window.localStorage.getItem(storageKey) === "1") return;
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Analytics is best-effort and must not block product usage.
    }

    void fetch("/api/product-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "APP_VISITED" }),
    }).catch(() => undefined);
  }, []);

  return null;
}
