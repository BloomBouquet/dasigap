import {
  BouquetAuthError,
  completeBouquetAuthorization,
  sessionCookie,
} from "../../../../src/auth/bouquet-oauth";
import {
  clearOauthStateCookie,
  oauthStateFromRequest,
} from "../../../../src/auth/bouquet-oauth-state-cookie";

function authErrorResponse(message: string) {
  const headers = new Headers({ "cache-control": "no-store" });
  headers.append("set-cookie", clearOauthStateCookie());
  return Response.json(
    { error: { code: "AUTH_ERROR", message } },
    { status: 400, headers },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const browserState = oauthStateFromRequest(request);

  if (!state || !browserState || browserState !== state) {
    return authErrorResponse("Authentication could not be completed");
  }

  try {
    const result = await completeBouquetAuthorization(
      url.searchParams.get("code"),
      state,
    );
    const registeredRedirectUri = process.env.BOUQUET_AUTH_REDIRECT_URI!;
    const location = new URL(result.returnTo, new URL(registeredRedirectUri).origin);
    const headers = new Headers({
      location: location.toString(),
      "cache-control": "no-store",
    });
    headers.append("set-cookie", sessionCookie(result.rawSession, result.maxAgeSeconds));
    headers.append("set-cookie", clearOauthStateCookie());

    return new Response(null, {
      status: 302,
      headers,
    });
  } catch (error) {
    const message = error instanceof BouquetAuthError
      ? "Authentication could not be completed"
      : "Internal authentication error";
    return authErrorResponse(message);
  }
}
