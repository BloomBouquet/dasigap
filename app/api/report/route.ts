import { requireUser } from "../../../src/auth/server-auth";
import { getOwnedUsageCostReport } from "../../../src/reports/sale-service";
import { toApiErrorResponse } from "../../../src/shared/api-error";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await requireUser(request);
    return Response.json(await getOwnedUsageCostReport(user.userId));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
