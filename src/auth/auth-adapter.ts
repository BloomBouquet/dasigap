import type { AuthenticatedUser } from "./types";

export interface AuthAdapter {
  getCurrentUser(request: Request): Promise<AuthenticatedUser | null>;
}
