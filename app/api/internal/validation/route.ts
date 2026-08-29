import { getValidationMetrics } from "../../../../src/analytics/metrics";
import { PRODUCT_EVENT_RETENTION_DAYS } from "../../../../src/analytics/retention";
import { AuthenticationError } from "../../../../src/auth/server-auth";
import {
  ValidationAdminAuthorizationError,
  ValidationAdminConfigurationError,
  requireValidationAdmin,
} from "../../../../src/internal/validation-admin";

export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  try {
    await requireValidationAdmin(request);

    const now = new Date();
    const metrics = await getValidationMetrics(now);

    return json({
      generatedAt: now.toISOString(),
      retentionDays: PRODUCT_EVENT_RETENTION_DAYS,
      metrics,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return json(
        { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
        401,
      );
    }

    if (error instanceof ValidationAdminConfigurationError) {
      return json(
        {
          error: {
            code: "VALIDATION_ADMIN_NOT_CONFIGURED",
            message: "Validation console is not configured",
          },
        },
        503,
      );
    }

    if (error instanceof ValidationAdminAuthorizationError) {
      return json({ error: { code: "FORBIDDEN", message: "Access denied" } }, 403);
    }

    return json(
      { error: { code: "INTERNAL_ERROR", message: "Validation metrics unavailable" } },
      500,
    );
  }
}
