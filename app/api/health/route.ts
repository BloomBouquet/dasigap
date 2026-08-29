export async function GET() {
  return Response.json(
    { status: "ok" },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
