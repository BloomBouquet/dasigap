import { z } from "zod";

import { requireUser } from "../../../../../src/auth/server-auth";
import { throwOwnedItemNotFound } from "../../../../../src/db/ownership";
import {
  recordOwnedItemSale,
  SaleValidationError,
} from "../../../../../src/reports/sale-service";
import {
  readJsonBody,
  toApiErrorResponse,
} from "../../../../../src/shared/api-error";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function itemId(context: Context) {
  const { id } = await context.params;
  if (!UUID.test(id)) throwOwnedItemNotFound();
  return id;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const user = await requireUser(request);
    const id = await itemId(context);
    const body = await readJsonBody(request);
    const sale = await recordOwnedItemSale(user.userId, id, body as never);
    return Response.json({ sale }, { status: 201 });
  } catch (error) {
    if (error instanceof SaleValidationError) {
      return Response.json(
        { error: { code: "VALIDATION_ERROR", message: error.message } },
        { status: 400 },
      );
    }
    if (error instanceof z.ZodError) {
      return toApiErrorResponse(error);
    }
    return toApiErrorResponse(error);
  }
}
