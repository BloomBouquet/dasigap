export const BOUQUET_OAUTH_STATE_COOKIE = "dasigap_oauth_state";

const OAUTH_STATE_TTL_SECONDS = 5 * 60;

function secureAttribute(nodeEnv: string) {
  return nodeEnv === "production" ? "; Secure" : "";
}

export function oauthStateCookie(
  state: string,
  nodeEnv = process.env.NODE_ENV ?? "production",
) {
  const normalizedState = state.trim();
  if (!normalizedState) {
    throw new RangeError("oauth_state_required");
  }

  return `${BOUQUET_OAUTH_STATE_COOKIE}=${encodeURIComponent(normalizedState)}; Path=/auth/bouquet; HttpOnly${secureAttribute(nodeEnv)}; SameSite=Lax; Max-Age=${OAUTH_STATE_TTL_SECONDS}`;
}

export function clearOauthStateCookie(
  nodeEnv = process.env.NODE_ENV ?? "production",
) {
  return `${BOUQUET_OAUTH_STATE_COOKIE}=; Path=/auth/bouquet; HttpOnly${secureAttribute(nodeEnv)}; SameSite=Lax; Max-Age=0`;
}

export function oauthStateFromRequest(request: Request) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;

  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== BOUQUET_OAUTH_STATE_COOKIE) continue;

    const rawValue = rest.join("=");
    if (!rawValue) return null;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return null;
    }
  }

  return null;
}
