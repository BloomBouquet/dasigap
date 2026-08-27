import { readMemorySignedObject } from "../../../../src/documents/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { token } = await context.params;
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(token)) {
    return new Response(null, { status: 404 });
  }

  const bytes = await readMemorySignedObject(token);
  if (!bytes) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/octet-stream",
      "x-content-type-options": "nosniff",
    },
  });
}
