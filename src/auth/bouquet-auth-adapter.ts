import type { AuthAdapter } from "./auth-adapter";
import { resolveBouquetProjectUser } from "./bouquet-oauth";

export class BouquetAuthAdapter implements AuthAdapter {
  async getCurrentUser(request: Request) {
    return resolveBouquetProjectUser(request);
  }
}
