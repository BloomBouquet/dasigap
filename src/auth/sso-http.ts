import type { SsoControllerResponse } from "./bouquet-sso-controller";

export function toSsoHttpResponse(output: SsoControllerResponse): Response {
  const headers = new Headers(output.headers);
  for (const cookie of output.cookies ?? []) {
    headers.append("Set-Cookie", cookie);
  }

  if (output.body === undefined) {
    return new Response(null, { status: output.status, headers });
  }

  return Response.json(output.body, { status: output.status, headers });
}
