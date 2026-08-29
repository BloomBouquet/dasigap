import { AuthenticationError, requireUser } from "../../../src/auth/server-auth";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return Response.json({ user }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json({ user: null }, { headers: { "cache-control": "private, no-store" } });
    }
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: "Authentication state unavailable" } },
      { status: 500, headers: { "cache-control": "private, no-store" } },
    );
  }
}
