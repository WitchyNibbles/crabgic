/**
 * Adversarial-review fix (2026-07-24): `ProcessProbeFn` must actually honor
 * `cwd`/`env` — the hermeticity self-test is meaningless otherwise (see
 * `./checks/hermeticity-selftest.ts`'s own tests for the concrete
 * regression this closes). This suite pins the real, process-spawning
 * implementation against a real child process (`node`), not a fake.
 */
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRealProcessProbe } from "./process-probe.js";

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await realpath(await mkdtemp(join(tmpdir(), "eo-process-probe-")));
});

afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

describe("createRealProcessProbe", () => {
  it("runs the spawned process in the supplied cwd", async () => {
    const probe = createRealProcessProbe();
    const result = await probe("node", ["-e", "process.stdout.write(process.cwd())"], {
      cwd: scratchDir,
    });
    expect(result.stdout.trim()).toBe(scratchDir);
  });

  it("replaces the spawned process's env with exactly the supplied object when env is given", async () => {
    const probe = createRealProcessProbe();
    // PATH is included only so `node` itself can be resolved by execvp —
    // MY_ISOLATED_VAR is the actual thing under test, and HOME (present in
    // this test process's own ambient env) must NOT leak through, proving
    // `env` replaces rather than merges.
    const result = await probe(
      "node",
      ["-e", "process.stdout.write(JSON.stringify(process.env))"],
      { env: { PATH: process.env.PATH ?? "", MY_ISOLATED_VAR: "isolated-value" } },
    );
    const parsedEnv = JSON.parse(result.stdout) as Record<string, string>;
    expect(parsedEnv.MY_ISOLATED_VAR).toBe("isolated-value");
    expect(parsedEnv.HOME).toBeUndefined();
  });

  it("inherits this process's own cwd/env when options are omitted (backward compatible default)", async () => {
    const probe = createRealProcessProbe();
    const result = await probe("node", ["-e", "process.stdout.write(process.cwd())"]);
    expect(result.stdout.trim()).toBe(process.cwd());
  });
});

/**
 * Roast round 21, finding 3 — `doctor` could hang forever.
 *
 * A SIGKILL landing inside bwrap's ~0-1ms setup window races
 * `--die-with-parent`'s `PR_SET_PDEATHSIG`: the in-namespace child can survive
 * holding the stdout pipe, so Node's `close` never fires and the promise never
 * settles. Measured 2/12 hangs at a 0ms kill, with `ps` showing stuck `bwrap`
 * processes still running 20+ minutes later. The probe had no ceiling at all.
 *
 * Exercised against a REAL process that really does hang, never a fixture --
 * round 19's lesson was that fixtures encoded a host that cannot exist.
 */
describe("createRealProcessProbe — timeoutMs", () => {
  it("settles a process that would otherwise never exit, and fails closed", async () => {
    const probe = createRealProcessProbe();
    const started = performance.now();

    const result = await probe("sh", ["-c", "sleep 300"], { timeoutMs: 400 });
    const elapsed = performance.now() - started;

    // It came back at all -- the property the hang violated.
    expect(elapsed).toBeLessThan(10_000);
    // And it came back as UNVERIFIED, not as a success. `exitCode: -1` with no
    // stdout is exactly the shape the sandbox check reads as "the command
    // never reported running".
    expect(result.exitCode).toBe(-1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("timed out");
  });

  it("does not truncate a process that finishes inside its ceiling", async () => {
    const probe = createRealProcessProbe();
    const result = await probe("sh", ["-c", "echo done; exit 3"], { timeoutMs: 10_000 });

    expect(result.stdout.trim()).toBe("done");
    expect(result.exitCode).toBe(3);
    expect(result.stderr).not.toContain("timed out");
  });

  it("keeps the output the process managed to emit before the ceiling", async () => {
    const probe = createRealProcessProbe();
    const result = await probe("sh", ["-c", "echo partial; sleep 300"], { timeoutMs: 600 });

    expect(result.stdout.trim()).toBe("partial");
    expect(result.exitCode).toBe(-1);
  });

  /**
   * Mutation-checked: deleting `child.kill("SIGKILL")` from the expiry path
   * survived every other assertion here. Resolving the promise while leaving
   * the process running is precisely the failure round 21 measured -- `ps`
   * showing stuck `bwrap` processes 20+ minutes after the probe returned.
   * Observed through a side effect the process performs AFTER the ceiling,
   * because the probe deliberately does not expose the pid.
   */
  it("actually kills the process it gave up on, rather than orphaning it", async () => {
    const { mkdtemp, rm, access } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = await mkdtemp(join(tmpdir(), "eo-probe-kill-"));
    try {
      const witness = join(dir, "still-alive");
      const probe = createRealProcessProbe();

      // Touches the witness one second AFTER the ceiling expires. If the
      // process survives, the file appears.
      const result = await probe("sh", ["-c", `sleep 1; : > '${witness}'`], { timeoutMs: 250 });
      expect(result.exitCode).toBe(-1);

      await new Promise((resolve) => setTimeout(resolve, 1500));
      await expect(access(witness)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  /**
   * Roast round 22: the round-21 test above passes only because `dash` holds
   * that whole script itself. ONE SUBSHELL DEEPER, the SIGKILL hit `sh` while
   * the grandchild survived, wrote its witness a second after the probe gave
   * up, and -- worse -- kept the probe's stdout/stderr pipes open, so `close`
   * never fired and both `PipeWrap` handles stayed ref'd. The hang round 21
   * removed was relocated to process exit: measured `node` still alive at 12s
   * with `activeResources: [PipeWrap, PipeWrap, Timeout]`, and round 21's own
   * test file orphaning two `sleep 300` processes per run.
   */
  it("kills the whole process tree, not just the direct child", async () => {
    const { mkdtemp, rm, access } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = await mkdtemp(join(tmpdir(), "eo-probe-tree-"));
    try {
      const witness = join(dir, "grandchild-survived");
      const probe = createRealProcessProbe();

      // `( ... ) & wait` forces a real grandchild. Killing the direct child
      // alone leaves it running, and it writes the witness after the ceiling.
      const result = await probe("sh", ["-c", `(sleep 1; : > '${witness}') & wait`], {
        timeoutMs: 250,
      });
      expect(result.exitCode).toBe(-1);

      await new Promise((resolve) => setTimeout(resolve, 1800));
      await expect(access(witness)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  /**
   * The other half of the same defect, and the one that actually hung the CLI:
   * a survivor holding the pipes stops the event loop draining. `bin.ts` sets
   * `process.exitCode` and relies on a natural exit, so ref'd handles mean
   * `crabgic doctor` never returns even after every check has reported.
   */
  it("leaves no handle holding the event loop open after a timeout", async () => {
    const countPipes = (): number =>
      process.getActiveResourcesInfo().filter((name) => name === "PipeWrap").length;

    // A DELTA, not an absolute count: the vitest worker holds its own IPC
    // pipes, and asserting none exist measured the runner rather than the
    // probe. (Round 22 measured this in a standalone `node`, where the
    // absolute count was meaningful; here it is not.)
    const before = countPipes();
    const probe = createRealProcessProbe();
    await probe("sh", ["-c", "(sleep 300) & wait"], { timeoutMs: 250 });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(countPipes()).toBe(before);
  });

  it("waits indefinitely when no ceiling is given, preserving the default", async () => {
    const probe = createRealProcessProbe();
    // A process that outlives any plausible timeout default would hang the
    // suite if one had been introduced silently.
    const result = await probe("sh", ["-c", "sleep 1.2; echo late"], {});
    expect(result.stdout.trim()).toBe("late");
    expect(result.exitCode).toBe(0);
  });
});
