import { requireUser } from "../../../../src/auth/server-auth";
import { throwOwnedItemNotFound } from "../../../../src/db/ownership";
import { deleteOwnedItemAndPrivateDocuments } from "../../../../src/documents/repository";
import {
  getOwnedItem,
  updateOwnedItem,
} from "../../../../src/items/repository";
import type { UpdateItemInput } from "../../../../src/items/schemas";
import {
  readJsonBody,
  toApiErrorResponse,
} from "../../../../src/shared/api-error";

export const runtime = "nodejs";

type ItemRouteContext = {
  params: Promise<{ id: string }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function ownedItemId(context: ItemRouteContext): Promise<string> {
  const { id } = await context.params;

  if (!UUID_PATTERN.test(id)) {
    throwOwnedItemNotFound();
  }

  return id;
}

export async function GET(
  request: Request,
  context: ItemRouteContext,
): Promise<Response> {
  try {
    const user = await requireUser(request);
    const itemId = await ownedItemId(context);
    const item = await getOwnedItem(user.userId, itemId);

    return Response.json({ item });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: ItemRouteContext,
): Promise<Response> {
  try {
    const user = await requireUser(request);
    const itemId = await ownedItemId(context);
    const body = await readJsonBody(request);
    const item = await updateOwnedItem(
      user.userId,
      itemId,
      body as UpdateItemInput,
    );

    return Response.json({ item });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: ItemRouteContext,
): Promise<Response> {
  try {
    const user = await requireUser(request);
    const itemId = await ownedItemId(context);
    await deleteOwnedItemAndPrivateDocuments(user.userId, itemId);

    return new Response(null, { status: 204 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
