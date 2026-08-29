import { checkReadiness } from "../../../../src/health/readiness";
import { getReleaseSha } from "../../../../src/health/release";

export async function GET() {
  const ready = await checkReadiness();

  return Response.json(
    {
      status: ready ? "ready" : "unavailable",
      release: getReleaseSha(),
    },
    {
      status: ready ? 200 : 503,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
