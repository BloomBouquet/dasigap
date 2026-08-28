import {
  clearSessionCookie,
  revokeBouquetProjectSession,
} from "../../../src/auth/bouquet-oauth";

export async function POST(request: Request) {
  await revokeBouquetProjectSession(request);
  return Response.json(
    { success: true },
    {
      headers: {
        "set-cookie": clearSessionCookie(),
        "cache-control": "private, no-store",
      },
    },
  );
}
