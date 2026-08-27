import { requireUser } from "../../../../../src/auth/server-auth";
import { throwOwnedItemNotFound } from "../../../../../src/db/ownership";
import {
  getOwnedLifecycle,
  updateOwnedLifecycle,
} from "../../../../../src/items/lifecycle-repository";
import { readJsonBody, toApiErrorResponse } from "../../../../../src/shared/api-error";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function itemId(context: Context) {
  const { id } = await context.params;
  if (!UUID.test(id)) throwOwnedItemNotFound();
  return id;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const user = await requireUser(request);
    const lifecycle = await getOwnedLifecycle(user.userId, await itemId(context));
    return Response.json({ lifecycle });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    const user = await requireUser(request);
    const body = await readJsonBody(request);
    const lifecycle = await updateOwnedLifecycle(user.userId, await itemId(context), body);
    return Response.json({ lifecycle });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
