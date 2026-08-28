import { createConfiguredBouquetSsoController } from "../../../../src/auth/configured-bouquet-sso";
import { toSsoHttpResponse } from "../../../../src/auth/sso-http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let controller;
  try {
    controller = createConfiguredBouquetSsoController();
  } catch {
    return Response.json(
      { error: "AUTH_CONFIGURATION_ERROR" },
      { status: 500 },
    );
  }

  try {
    return toSsoHttpResponse(
      await controller.logout(request.headers.get("cookie")),
    );
  } catch {
    return Response.json({ error: "AUTH_LOGOUT_FAILED" }, { status: 500 });
  }
}
