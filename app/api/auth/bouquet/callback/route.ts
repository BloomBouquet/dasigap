import { createConfiguredBouquetSsoController } from "../../../../../src/auth/configured-bouquet-sso";
import { toSsoHttpResponse } from "../../../../../src/auth/sso-http";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  let controller;
  try {
    controller = createConfiguredBouquetSsoController();
  } catch {
    return Response.json(
      { error: "AUTH_CONFIGURATION_ERROR" },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  try {
    const output = await controller.callback({
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
      cookieHeader: request.headers.get("cookie"),
    });
    return toSsoHttpResponse(output);
  } catch {
    return Response.json({ error: "AUTH_CALLBACK_FAILED" }, { status: 500 });
  }
}
