import { requireUser } from "../../../src/auth/server-auth";
import { createItem, listItems } from "../../../src/items/repository";
import {
  readJsonBody,
  toApiErrorResponse,
} from "../../../src/shared/api-error";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await requireUser(request);
    const items = await listItems(user.userId);

    return Response.json({ items });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser(request);
    const body = await readJsonBody(request);
    const item = await createItem(user.userId, body as never);

    return Response.json({ item }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
