import { NextResponse } from "next/server";

import { getReleaseSha } from "../../../../src/health/release";

export async function GET() {
  return NextResponse.json(
    { status: "ok", service: "dasigap", release: getReleaseSha() },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
