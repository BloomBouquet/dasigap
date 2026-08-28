import type { NextConfig } from "next";

import { securityHeaders } from "./src/shared/security";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders(process.env.NODE_ENV ?? "production"),
      },
    ];
  },
};

export default nextConfig;
