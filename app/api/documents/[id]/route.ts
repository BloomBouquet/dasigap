import { requireUser } from "../../../../src/auth/server-auth";
import { throwOwnedItemNotFound } from "../../../../src/db/ownership";
import { deleteOwnedDocument } from "../../../../src/documents/repository";
import { ObjectStorageOperationError } from "../../../../src/documents/storage";
import { toApiErrorResponse } from "../../../../src/shared/api-error";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function documentId(context: Context) {
  const { id } = await context.params;
  if (!UUID.test(id)) throwOwnedItemNotFound();
  return id;
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    const user = await requireUser(request);
    await deleteOwnedDocument(user.userId, await documentId(context));
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ObjectStorageOperationError) {
      return Response.json(
        { error: { code: "INTERNAL_ERROR", message: "문서 삭제를 완료하지 못했습니다. 다시 시도해주세요." } },
        { status: 503 },
      );
    }
    return toApiErrorResponse(error);
  }
}
