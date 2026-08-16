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

/**
 * THE 108-BYTE CEILING — measured 2026-08-16, and the reason no crabgic worker
 * could run a command.
 *
 * `sun_path` in `sockaddr_un` is 108 bytes on Linux. The engine's command
 * sandbox creates its bridge sockets under `TMPDIR`, so a deep `TMPDIR` leaves
 * no room for the socket name and every `Bash` call dies with:
 *
 *     Sandbox is required but failed to initialize:
 *     Failed to create bridge sockets after 5 attempts.
 *
 * The real provisioned path was 101 characters —
 * `<cache>/<projectHash>/worktrees/workers/<work-unit-uuid>/tmp` — leaving
 * seven. Isolated by probe: the same strict worker env with a SHORT `TMPDIR`
 * runs `echo` fine; with a long one it fails. Both controls recorded in
 * `docs/evidence/phase-25/published-unverified.md`.
 *
 * The consequence was not a broken sandbox but a silent one: workers could not
 * run tests, reported success anyway, and runs published unverified work.
 */
describe("TMPDIR must fit a unix domain socket", () => {
  it("leaves usable room under the 108-byte sun_path limit", async () => {
    const base = await mkdtemp(join(tmpdir(), "crabgic-provisioning-"));
    const provisioning = await provisionWorkerDirs(
      join(base, "worktrees", "workers"),
      "1c7d5e92-4a63-4f18-8b20-6e93c1a7d044",
    );
    // A socket name needs real room, not the last byte. 40 is comfortably
    // more than any observed bridge-socket filename and still far below 108.
    expect(provisioning.TMP.length).toBeLessThanOrEqual(108 - 40);
  });

  it("stays short even for a deeply nested base dir — the real shape", async () => {
    // What production actually passes: an XDG cache root, a project hash, and
    // two path segments before the worker id.
    const deep = await mkdtemp(join(tmpdir(), "crabgic-deep-"));
    const base = join(deep, ".cache", "crabgic", "47ea4ed1d22b4abf", "worktrees", "workers");
    const provisioning = await provisionWorkerDirs(base, "1c7d5e92-4a63-4f18-8b20-6e93c1a7d044");
    expect(provisioning.TMP.length).toBeLessThanOrEqual(108 - 40);
  });
});
