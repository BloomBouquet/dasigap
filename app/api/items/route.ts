import {
  parseRegistrationDuration,
  recordProductEvent,
} from "../../../src/analytics/events";
import { requireUser } from "../../../src/auth/server-auth";
import { createItem, listItems } from "../../../src/items/repository";
import type { CreateItemInput } from "../../../src/items/schemas";
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
    const item = await createItem(user.userId, body as CreateItemInput);

    try {
      await recordProductEvent({
        userId: user.userId,
        itemId: item.id,
        type: "ITEM_REGISTRATION_COMPLETED",
        durationMs: parseRegistrationDuration(
          request.headers.get("x-dasigap-registration-duration-ms"),
        ),
      });
    } catch {
      console.error("Failed to record item registration analytics");
    }

    return Response.json({ item }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
