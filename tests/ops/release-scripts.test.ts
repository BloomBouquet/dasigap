import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dasigap-release-"));
  await mkdir(join(root, "releases"), { recursive: true });
  await mkdir(join(root, "shared"), { recursive: true });
  await writeFile(join(root, "shared", ".env.production"), "PORT=3000\n");
});

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
});
