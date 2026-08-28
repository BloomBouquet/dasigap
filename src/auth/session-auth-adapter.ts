import type { AuthAdapter } from "./auth-adapter";
import {
  sessionTokenFromCookie,
  type AuthSessionStore,
} from "./auth-session";
import type { AuthenticatedUser } from "./types";

export class SessionAuthAdapter implements AuthAdapter {
  private readonly sessions: AuthSessionStore;

  constructor(sessions: AuthSessionStore) {
    this.sessions = sessions;
  }

  async getCurrentUser(request: Request): Promise<AuthenticatedUser | null> {
    const token = sessionTokenFromCookie(request.headers.get("cookie"));
    if (!token) {
      return null;
    }

    return this.sessions.resolve(token);
  }
}
