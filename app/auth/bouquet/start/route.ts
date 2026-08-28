import { beginBouquetAuthorization, BouquetAuthError } from "../../../../src/auth/bouquet-oauth";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const location = await beginBouquetAuthorization(url.searchParams.get("returnTo"));
    return new Response(null, {
      status: 302,
      headers: {
        location: location.toString(),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof BouquetAuthError ? "Unable to start authentication" : "Internal authentication error";
    return Response.json({ error: { code: "AUTH_ERROR", message } }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
