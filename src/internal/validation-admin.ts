import { requireUser } from "../auth/server-auth";

export class ValidationAdminConfigurationError extends Error {
  constructor() {
    super("validation_admin_not_configured");
    this.name = "ValidationAdminConfigurationError";
  }
}

export class ValidationAdminAuthorizationError extends Error {
  constructor() {
    super("validation_admin_forbidden");
    this.name = "ValidationAdminAuthorizationError";
  }
}

export function parseValidationAdminUserIds(value: string | undefined): Set<string> {
  const ids = new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

  if (ids.size === 0) {
    throw new ValidationAdminConfigurationError();
  }

  return ids;
}

export async function requireValidationAdmin(request: Request) {
  const user = await requireUser(request);
  const allowed = parseValidationAdminUserIds(process.env.VALIDATION_ADMIN_USER_IDS);

  if (!allowed.has(user.userId)) {
    throw new ValidationAdminAuthorizationError();
  }

  return user;
}
