import { requireUser } from "../../../src/auth/server-auth";
import {
  clientProductEventSchema,
  kstDateKey,
  recordProductEvent,
  recordProductEventOnce,
} from "../../../src/analytics/events";
import { getOwnedItem } from "../../../src/items/repository";
import {
  readJsonBody,
  toApiErrorResponse,
} from "../../../src/shared/api-error";

export const runtime = "nodejs";

function noStore(response: Response) {
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser(request);
    const body = await readJsonBody(request);
    const event = clientProductEventSchema.parse(body);

    if ("itemId" in event) {
      await getOwnedItem(user.userId, event.itemId);
    }

    if (event.type === "APP_VISITED") {
      const now = new Date();
      await recordProductEventOnce({
        userId: user.userId,
        type: event.type,
        dedupeKey: `visit:${user.userId}:${kstDateKey(now)}`,
      });
      return noStore(Response.json({ accepted: true }, { status: 202 }));
    }

    const stored = await recordProductEvent({
      userId: user.userId,
      itemId: "itemId" in event ? event.itemId : null,
      type: event.type,
    });

    if (event.type === "ITEM_REGISTRATION_STARTED") {
      return noStore(Response.json({ eventId: stored.id }, { status: 201 }));
    }

    return noStore(Response.json({ accepted: true }, { status: 202 }));
  } catch (error) {
    return noStore(toApiErrorResponse(error));
  }
}
