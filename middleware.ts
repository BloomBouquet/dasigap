import { NextResponse, type NextRequest } from "next/server";

import { securityHeaders } from "./src/shared/security";

export function middleware(_request: NextRequest) {
  const response = NextResponse.next();

  for (const header of securityHeaders(process.env.NODE_ENV ?? "production")) {
    response.headers.set(header.key, header.value);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
