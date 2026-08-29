import { NextResponse } from "next/server";

import { checkReadiness } from "../../../../src/health/readiness";
import { getReleaseSha } from "../../../../src/health/release";

export async function GET() {
  const ready = await checkReadiness();

  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      service: "dasigap",
      release: getReleaseSha(),
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
