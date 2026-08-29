import {
  recordProductEvent,
  resolveRegistrationDurationMs,
} from "../../../src/analytics/events";
import { requireUser } from "../../../src/auth/server-auth";
import { createItem, listItems } from "../../../src/items/repository";
import type { CreateItemInput } from "../../../src/items/schemas";
import {
  readJsonBody,
  toApiErrorResponse,
} from "../../../src/shared/api-error";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const objectBody =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const { registrationStartEventId, ...itemInput } = objectBody;
    const item = await createItem(user.userId, itemInput as CreateItemInput);

    const completedAt = new Date();
    let durationMs: number | null = null;

    if (
      typeof registrationStartEventId === "string" &&
      UUID.test(registrationStartEventId)
    ) {
      try {
        durationMs = await resolveRegistrationDurationMs(
          user.userId,
          registrationStartEventId,
          completedAt,
        );
      } catch {
        console.error("Failed to resolve item registration analytics duration");
      }
    }

    try {
      await recordProductEvent({
        userId: user.userId,
        itemId: item.id,
        type: "ITEM_REGISTRATION_COMPLETED",
        durationMs,
      });
    } catch {
      console.error("Failed to record item registration analytics");
    }

    return Response.json({ item }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
