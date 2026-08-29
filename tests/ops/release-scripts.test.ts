import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
let root = "";
let bin = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dasigap-release-"));
  bin = join(root, "bin");
  await mkdir(join(root, "releases"), { recursive: true });
  await mkdir(join(root, "shared"), { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(join(root, "shared", ".env.production"), "PORT=3000\nNODE_ENV=production\n");
});

async function installed(sha: string) {
  const release = join(root, "releases", sha);
  await mkdir(join(release, "ops", "pm2"), { recursive: true });
  await writeFile(
    join(release, "release-metadata.json"),
    `${JSON.stringify({ service: "dasigap", commitSha: sha })}\n`,
  );
  await writeFile(join(release, "ops", "pm2", "ecosystem.config.cjs"), "module.exports = {};\n");
  return release;
}

async function executable(name: string, body: string) {
  const path = join(bin, name);
  await writeFile(path, `#!/usr/bin/env bash\nset -Eeuo pipefail\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

function switchEnv(candidate: string, curl: string, pm2: string) {
  return {
    ...process.env,
    DASIGAP_ROOT: root,
    CANDIDATE_VALIDATOR: candidate,
    CURL_BIN: curl,
    PM2_BIN: pm2,
  };
}

describe("production release scripts", () => {
  it("rejects traversal instead of constructing a release path", async () => {
    await expect(
      exec(
        "bash",
        ["-c", "source ops/release/common.sh; release_path '../../etc/passwd'"],
        { env: { ...process.env, DASIGAP_ROOT: root } },
      ),
    ).rejects.toMatchObject({ code: 64 });
  });

  it("leaves current untouched when candidate validation fails", async () => {
    const oldSha = "1".repeat(40);
    const targetSha = "2".repeat(40);
    const oldRelease = await installed(oldSha);
    await installed(targetSha);
    await symlink(oldRelease, join(root, "current"));

    const candidate = await executable("candidate-fail", "exit 9");
    const curl = await executable("curl-unused", "exit 99");
    const pm2 = await executable("pm2-unused", "exit 99");

    await expect(
      exec("bash", ["ops/release/switch-release.sh", targetSha, "https://dasigap.invalid"], {
        env: switchEnv(candidate, curl, pm2),
      }),
    ).rejects.toBeTruthy();

    expect(await readlink(join(root, "current"))).toBe(oldRelease);
  });

  it("atomically selects a healthy release and records previous", async () => {
    const oldSha = "3".repeat(40);
    const targetSha = "4".repeat(40);
    const oldRelease = await installed(oldSha);
    const targetRelease = await installed(targetSha);
    await symlink(oldRelease, join(root, "current"));

    const candidate = await executable("candidate-ok", "exit 0");
    const pm2 = await executable("pm2-ok", `echo "$*" >> "${root}/pm2.log"`);
    const curl = await executable(
      "curl-ok",
      `url="\${!#}"\ncase "$url" in\n  */live) status=ok ;;\n  */ready) status=ready ;;\n  *) exit 22 ;;\nesac\nprintf '{"status":"%s","release":"${targetSha}"}\\n' "$status"`,
    );

    await exec("bash", ["ops/release/switch-release.sh", targetSha, "https://dasigap.invalid"], {
      env: switchEnv(candidate, curl, pm2),
    });

    expect(await readlink(join(root, "current"))).toBe(targetRelease);
    expect(await readlink(join(root, "previous"))).toBe(oldRelease);
    expect(await readFile(join(root, "pm2.log"), "utf8")).toContain("startOrReload");
  });

  it("restores the old release when post-switch external readiness fails", async () => {
    const oldSha = "5".repeat(40);
    const targetSha = "6".repeat(40);
    const oldRelease = await installed(oldSha);
    await installed(targetSha);
    await symlink(oldRelease, join(root, "current"));

    const candidate = await executable("candidate-ok", "exit 0");
    const pm2 = await executable("pm2-ok", `echo "$*" >> "${root}/pm2.log"`);
    const curl = await executable(
      "curl-local-only",
      `url="\${!#}"\nif [[ "$url" == https://* ]]; then exit 22; fi\ncase "$url" in\n  */live) status=ok ;;\n  */ready) status=ready ;;\n  *) exit 22 ;;\nesac\nprintf '{"status":"%s","release":"${targetSha}"}\\n' "$status"`,
    );

    await expect(
      exec("bash", ["ops/release/switch-release.sh", targetSha, "https://dasigap.invalid"], {
        env: switchEnv(candidate, curl, pm2),
      }),
    ).rejects.toBeTruthy();

    expect(await readlink(join(root, "current"))).toBe(oldRelease);
  });
});
