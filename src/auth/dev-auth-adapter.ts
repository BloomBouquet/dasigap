import type { AuthAdapter } from "./auth-adapter";
import type { AuthenticatedUser } from "./types";

const DEV_USER_HEADER = "x-dasigap-dev-user";

export class DevAuthAdapter implements AuthAdapter {
  async getCurrentUser(request: Request): Promise<AuthenticatedUser | null> {
    const userId = request.headers.get(DEV_USER_HEADER)?.trim();

    if (!userId) {
      return null;
    }

    return { userId };
  }
}
