import { getReleaseSha } from "../../../../src/health/release";

export async function GET() {
  return Response.json(
    { status: "ok", release: getReleaseSha() },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
