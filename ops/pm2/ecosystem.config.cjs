const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");

const root = process.env.DASIGAP_ROOT || "/home/ubuntu/dasigap";
const current = path.join(root, "current");
const envFile = path.join(root, "shared", ".env.production");
const metadataFile = path.join(current, "release-metadata.json");

if (!fs.existsSync(envFile)) {
  throw new Error("production environment is missing");
}
process.loadEnvFile(envFile);

const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
if (metadata.service !== "dasigap" || !/^[0-9a-f]{40}$/.test(metadata.commitSha)) {
  throw new Error("invalid release metadata");
}

const port = String(process.env.PORT || "3000");
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error("invalid production port");
}

module.exports = {
  apps: [
    {
      name: "dasigap",
      cwd: current,
      script: path.join(current, "node_modules", "next", "dist", "bin", "next"),
      args: "start",
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: port,
        DASIGAP_ROOT: root,
        DASIGAP_RELEASE_SHA: metadata.commitSha,
      },
      autorestart: true,
      min_uptime: "10s",
      max_restarts: 10,
      kill_timeout: 5000,
    },
  ],
};
