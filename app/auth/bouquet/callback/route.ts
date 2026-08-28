import {
  BouquetAuthError,
  completeBouquetAuthorization,
  sessionCookie,
} from "../../../../src/auth/bouquet-oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const result = await completeBouquetAuthorization(
      url.searchParams.get("code"),
      url.searchParams.get("state"),
    );
    const registeredRedirectUri = process.env.BOUQUET_AUTH_REDIRECT_URI!;
    const location = new URL(result.returnTo, new URL(registeredRedirectUri).origin);
    return new Response(null, {
      status: 302,
      headers: {
        location: location.toString(),
        "set-cookie": sessionCookie(result.rawSession, result.maxAgeSeconds),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof BouquetAuthError
      ? "Authentication could not be completed"
      : "Internal authentication error";
    return Response.json(
      { error: { code: "AUTH_ERROR", message } },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
