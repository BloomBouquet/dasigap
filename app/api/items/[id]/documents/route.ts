import { requireUser } from "../../../../../src/auth/server-auth";
import { throwOwnedItemNotFound } from "../../../../../src/db/ownership";
import {
  listOwnedDocuments,
  uploadOwnedDocument,
} from "../../../../../src/documents/repository";
import { toApiErrorResponse } from "../../../../../src/shared/api-error";

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
    const documents = await listOwnedDocuments(user.userId, await itemId(context));
    return Response.json({ documents });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const user = await requireUser(request);
    const form = await request.formData();
    const document = await uploadOwnedDocument({
      userId: user.userId,
      itemId: await itemId(context),
      type: form.get("type"),
      file: form.get("file"),
    });
    return Response.json({ document }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
