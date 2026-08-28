export type SecurityHeader = { key: string; value: string };

export function buildContentSecurityPolicy(nodeEnv = "production") {
  const developmentScriptPolicy = nodeEnv === "development" ? " 'unsafe-eval'" : "";
  const developmentConnectPolicy = nodeEnv === "development" ? " ws: wss:" : "";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline'${developmentScriptPolicy}`,
    `connect-src 'self'${developmentConnectPolicy}`,
  ].join("; ");
}

export function securityHeaders(nodeEnv = "production"): SecurityHeader[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy(nodeEnv) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}
