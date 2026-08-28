"use client";

import { useEffect, useRef } from "react";

export function AppVisitTracker() {
  const trackedRef = useRef(false);

  useEffect(() => {
    if (trackedRef.current) return;
    trackedRef.current = true;

    void fetch("/api/product-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "APP_VISITED" }),
    }).catch(() => undefined);
  }, []);

  return null;
}
