import { recordProductEvent } from "../../../src/analytics/events";
import { requireUser } from "../../../src/auth/server-auth";
import { getOwnedUsageCostReport } from "../../../src/reports/sale-service";
import { toApiErrorResponse } from "../../../src/shared/api-error";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await requireUser(request);
    const report = await getOwnedUsageCostReport(user.userId);

    try {
      await recordProductEvent({ userId: user.userId, type: "USAGE_COST_VIEWED" });
    } catch {
      console.error("Failed to record usage cost analytics");
    }

    return Response.json(report);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
