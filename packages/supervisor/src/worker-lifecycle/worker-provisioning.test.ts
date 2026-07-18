import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { provisionWorkerDirs, WORKER_PROVISION_DIR_MODE } from "./worker-provisioning.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-supervisor-provision-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("provisionWorkerDirs", () => {
  it("creates HOME/TMP/CLAUDE_CONFIG_DIR, each 0700 and distinct", async () => {
    const provisioning = await provisionWorkerDirs(root, "worker-1");
    const paths = [provisioning.HOME, provisioning.TMP, provisioning.CLAUDE_CONFIG_DIR];
    expect(new Set(paths).size).toBe(3);
    for (const dir of paths) {
      const st = await stat(dir);
      expect(st.isDirectory()).toBe(true);
      expect(st.mode & 0o777).toBe(WORKER_PROVISION_DIR_MODE);
    }
  });

  it("isolates two different workers into disjoint directory trees", async () => {
    const a = await provisionWorkerDirs(root, "worker-a");
    const b = await provisionWorkerDirs(root, "worker-b");
    expect(a.HOME).not.toBe(b.HOME);
    expect(a.CLAUDE_CONFIG_DIR).not.toBe(b.CLAUDE_CONFIG_DIR);
  });

  it("is idempotent — calling it twice for the same workerId does not throw", async () => {
    await provisionWorkerDirs(root, "worker-1");
    await expect(provisionWorkerDirs(root, "worker-1")).resolves.toBeDefined();
  });
});
