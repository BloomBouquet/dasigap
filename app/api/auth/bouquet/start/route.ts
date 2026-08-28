import { createConfiguredBouquetSsoController } from "../../../../../src/auth/configured-bouquet-sso";
import { InvalidReturnToError } from "../../../../../src/auth/bouquet-sso-controller";
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

  const returnTo = new URL(request.url).searchParams.get("returnTo") ?? undefined;
  try {
    return toSsoHttpResponse(await controller.start(returnTo));
  } catch (error) {
    if (error instanceof InvalidReturnToError) {
      return Response.json({ error: "INVALID_RETURN_TO" }, { status: 400 });
    }
    return Response.json({ error: "AUTH_START_FAILED" }, { status: 500 });
  }
}
