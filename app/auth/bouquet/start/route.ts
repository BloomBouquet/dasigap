import { beginBouquetAuthorization, BouquetAuthError } from "../../../../src/auth/bouquet-oauth";
import { oauthStateCookie } from "../../../../src/auth/bouquet-oauth-state-cookie";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const location = await beginBouquetAuthorization(url.searchParams.get("returnTo"));
    const state = location.searchParams.get("state");
    if (!state) throw new BouquetAuthError("bouquet_state_missing");

    const headers = new Headers({
      location: location.toString(),
      "cache-control": "no-store",
    });
    headers.append("set-cookie", oauthStateCookie(state));

    return new Response(null, {
      status: 302,
      headers,
    });
  } catch (error) {
    const message = error instanceof BouquetAuthError ? "Unable to start authentication" : "Internal authentication error";
    return Response.json({ error: { code: "AUTH_ERROR", message } }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
