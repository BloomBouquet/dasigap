import { recordProductEvent } from "../../../../../src/analytics/events";
import { requireUser } from "../../../../../src/auth/server-auth";
import { throwOwnedItemNotFound } from "../../../../../src/db/ownership";
import {
  createOwnedMaintenance,
  listOwnedMaintenance,
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

async function trackLifecycleUpdate(userId: string, id: string) {
  try {
    await recordProductEvent({ userId, itemId: id, type: "ITEM_LIFECYCLE_UPDATED" });
  } catch {
    console.error("Failed to record maintenance lifecycle analytics");
  }
}

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const user = await requireUser(request);
    const maintenance = await listOwnedMaintenance(user.userId, await itemId(context));
    return Response.json({ maintenance });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const user = await requireUser(request);
    const id = await itemId(context);
    const maintenance = await createOwnedMaintenance(
      user.userId,
      id,
      await readJsonBody(request),
    );
    await trackLifecycleUpdate(user.userId, id);
    return Response.json({ maintenance }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
