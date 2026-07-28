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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRealProcessProbe,
  killProcessTreeForTest,
  liveDetachedChildCountForTest,
} from "./process-probe.js";

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

/**
 * Roast round 23, finding 1 — `detached: true` made probe children immune to
 * Ctrl-C.
 *
 * A detached child leads its own process group, so it is not in the terminal's
 * foreground group and never receives SIGINT. Measured end-to-end against the
 * real CLI with a `bwrap` whose `--version` hangs: SIGINT to `crabgic doctor`
 * left the probe alive and reparented to init (survivors: 1), while the same
 * build with the handler install removed... left it alive too — that IS the
 * control, and the fixed build leaves survivors: 0, twice.
 *
 * Real bwrap's `--die-with-parent` masks this for the confinement probe, but
 * the PRESENCE probe carries no such flag, and any non-real `bwrap` escapes
 * both. The group kill lived only in a timer, and a timer dies with the CLI.
 */
describe("createRealProcessProbe — a bounded child must not outlive the CLI", () => {
  it("registers a bounded child and releases it once settled", async () => {
    const probe = createRealProcessProbe();
    const before = liveDetachedChildCountForTest();

    const pending = probe("sh", ["-c", "exit 0"], { timeoutMs: 5_000 });
    // Registered while in flight.
    expect(liveDetachedChildCountForTest()).toBeGreaterThan(before);

    await pending;
    // And released, so the set cannot grow without bound across a long run.
    expect(liveDetachedChildCountForTest()).toBe(before);
  });

  it("releases a child that had to be killed on expiry, not only a clean one", async () => {
    const probe = createRealProcessProbe();
    const before = liveDetachedChildCountForTest();

    await probe("sh", ["-c", "sleep 300"], { timeoutMs: 250 });

    expect(liveDetachedChildCountForTest()).toBe(before);
  });

  it("never registers an UNBOUNDED child, which is not detached and dies with the CLI already", async () => {
    const probe = createRealProcessProbe();
    const before = liveDetachedChildCountForTest();

    const pending = probe("sh", ["-c", "exit 0"]);
    expect(liveDetachedChildCountForTest()).toBe(before);

    await pending;
    expect(liveDetachedChildCountForTest()).toBe(before);
  });

  it("installs a signal handler, exactly once, however many probes run", async () => {
    const probe = createRealProcessProbe();
    await probe("sh", ["-c", "exit 0"], { timeoutMs: 5_000 });
    const afterFirst = process.listenerCount("SIGINT");
    expect(afterFirst).toBeGreaterThan(0);

    await probe("sh", ["-c", "exit 0"], { timeoutMs: 5_000 });
    await probe("sh", ["-c", "exit 0"], { timeoutMs: 5_000 });

    // Installed once. A per-call handler would exhaust the listener limit and
    // print a MaxListenersExceededWarning on a long doctor run.
    expect(process.listenerCount("SIGINT")).toBe(afterFirst);
  });
});

/**
 * Roast round 23, finding 2 — the stream-destroy backstop had no test that
 * could fire.
 *
 * Deleting `child.stdout?.destroy(); child.stderr?.destroy()` left the suite
 * 44/44 green, INCLUDING the test written for exactly that line: the group kill
 * already reaps every pipe holder, so the pipes close naturally either way.
 *
 * The backstop earns its place against a descendant that LEAVES the group —
 * `setsid` — while holding stdout. Measured in standalone node: with the
 * destroys, `activeResources: [Timeout]` and `rc=0`; without them,
 * `[PipeWrap, PipeWrap, Timeout]` and `rc=124`, the CLI never exiting.
 */
describe("createRealProcessProbe — a group-escaping descendant must not hold the loop", () => {
  it("releases the pipes even when a descendant escapes the process group", async () => {
    const countPipes = (): number =>
      process.getActiveResourcesInfo().filter((name) => name === "PipeWrap").length;

    const before = countPipes();
    const probe = createRealProcessProbe();

    // `setsid` puts the grandchild in a NEW session and group, so the expiry
    // group-kill cannot reach it; it keeps stdout open. It exits on its own
    // shortly after, so nothing is leaked past this test.
    await probe("sh", ["-c", "setsid sleep 4 & wait"], { timeoutMs: 250 });
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(countPipes()).toBe(before);
  });
});

/**
 * Round 25 (finding 7) rewrote this block. It carried round 23's rationale for
 * a gate round 24 REVERTED, asserting in its own name that the group kill "is
 * not used on a reaped child" — directly above the sibling describe that
 * asserts the opposite — while its body only ever covered the live-child case.
 * A comment that contradicts the code it sits on is worse than none: rounds 4-8
 * each went wrong reasoning from a stale paragraph exactly like it.
 *
 * The recycle hazard is real but was mis-quantified; see `killProcessTree`'s own
 * comment for the corrected numbers and why the group kill stays.
 */
describe("killProcessTree — a live child's group is the kill target", () => {
  it("uses the group form for a child still running at expiry", async () => {
    const killed: (number | string)[] = [];
    const realKill = process.kill.bind(process);
    const spy = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: string) => {
      killed.push(pid);
      return realKill(pid, signal as NodeJS.Signals);
    }) as typeof process.kill);

    try {
      const probe = createRealProcessProbe();
      // A live child at expiry: the group form is correct and expected.
      await probe("sh", ["-c", "sleep 300"], { timeoutMs: 250 });
      expect(killed.some((pid) => typeof pid === "number" && pid < 0)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("createRealProcessProbe — detachment follows the ceiling, and only the ceiling", () => {
  async function childPgid(options?: { timeoutMs?: number }): Promise<string> {
    const probe = createRealProcessProbe();
    const result = await probe("sh", ["-c", "ps -o pgid= -p $$"], options);
    return result.stdout.trim();
  }

  it("puts a BOUNDED child in its own group, and an UNBOUNDED one in ours", async () => {
    const { execSync } = await import("node:child_process");
    const ownPgid = execSync(`ps -o pgid= -p ${String(process.pid)}`)
      .toString()
      .trim();

    // Unbounded: same group as this process, so a terminal SIGINT reaches it
    // exactly as it did before ceilings existed.
    expect(await childPgid()).toBe(ownPgid);

    // Bounded: its own group -- which is what makes the expiry group-kill
    // possible, and what the signal sweep exists to compensate for.
    expect(await childPgid({ timeoutMs: 5_000 })).not.toBe(ownPgid);
  });
});

/**
 * Round 23, finding 3 — the reaped-child branch. Unreachable deterministically
 * through a real spawn (it needs `close` not to have fired while the child has
 * been reaped), so the branch is exercised directly.
 */
describe("killProcessTree — the group is always the target while pipes may be held", () => {
  function fakeChild(
    over: Partial<Record<string, unknown>>,
  ): Parameters<typeof killProcessTreeForTest>[0] {
    return {
      pid: 4242,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => true),
      stdout: undefined,
      stderr: undefined,
      ...over,
    } as unknown as Parameters<typeof killProcessTreeForTest>[0];
  }

  it.each([
    ["still running", {}],
    // ROUND 24: these three USED to assert the opposite -- that a reaped child
    // must not be group-killed -- and in doing so the suite enforced the
    // orphan. A reaped `sh` whose grandchild holds the pipes is the single
    // commonest shape this exists to kill.
    ["exited normally", { exitCode: 0 }],
    ["exited non-zero", { exitCode: 137 }],
    ["killed by a signal", { signalCode: "SIGKILL" }],
  ])("targets the group for a child that %s", (_name, over) => {
    const spy = vi.spyOn(process, "kill").mockImplementation((() => true) as typeof process.kill);
    try {
      killProcessTreeForTest(fakeChild(over));
      expect(spy).toHaveBeenCalledWith(-4242, "SIGKILL");
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * Round 23, finding 1, END TO END — and the mutant that survived everything
 * else.
 *
 * Deleting `killAllDetachedChildren()` from the signal handler left the suite
 * green: the registry was still maintained, the handler was still installed,
 * and nothing checked that it did the one thing it exists for. Verified
 * manually against the real CLI (survivors 1 without the fix, 0 with it,
 * twice), which is exactly the kind of proof that does not survive contact
 * with a refactor. Automated here.
 *
 * A real child process is required: sending SIGINT to the vitest worker would
 * kill the run. The helper starts a bounded probe whose grandchild outlives it,
 * then takes a SIGINT the way a user's Ctrl-C delivers one.
 */
describe("createRealProcessProbe — SIGINT to the CLI must take the probe with it", () => {
  it("kills a detached probe child when the process is interrupted", async () => {
    const { spawn: spawnHelper } = await import("node:child_process");
    const { writeFile, mkdtemp, rm, access } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join, resolve } = await import("node:path");

    const dir = await mkdtemp(join(tmpdir(), "eo-sigint-"));
    try {
      const witness = join(dir, "probe-survived-sigint");
      const { fileURLToPath } = await import("node:url");
      const here = fileURLToPath(new URL(".", import.meta.url));
      const modulePath = resolve(here, "process-probe.ts");
      const helper = join(dir, "helper.mts");
      // The probe's child writes the witness 2s from now. If SIGINT does not
      // take it down, the witness appears.
      await writeFile(
        helper,
        `import { createRealProcessProbe } from ${JSON.stringify(modulePath)};\n` +
          `const probe = createRealProcessProbe();\n` +
          `probe("sh", ["-c", "sleep 2; : > '${witness}'"], { timeoutMs: 60000 });\n` +
          `setTimeout(() => { process.stdout.write("ready\\n"); }, 400);\n` +
          `setTimeout(() => {}, 60000);\n`,
      );

      // ROUND 25: `node_modules/.bin/tsx` is a WRAPPER PROCESS, so a signal
      // sent here landed on tsx and the test measured tsx's disposition rather
      // than the probe's. Deleting the re-raise from the product left it green.
      // `node --import tsx` loads the same TypeScript in ONE process, which is
      // the process under test.
      const child = spawnHelper(process.execPath, ["--import", "tsx", helper], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      await new Promise<void>((done) => {
        child.stdout.on("data", (chunk: Buffer) => {
          if (chunk.toString("utf8").includes("ready")) done();
        });
      });

      child.kill("SIGINT");
      await new Promise((r) => setTimeout(r, 3000));

      await expect(access(witness)).rejects.toThrow();
      child.kill("SIGKILL");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 25_000);
});

/**
 * Roast round 24 — round 23's reaped gate re-opened round 22's orphan.
 *
 * Round 23 skipped the group kill for a child that had already been reaped,
 * reasoning that a pid could be recycled. But it argued the case needed "a
 * descendant OUTSIDE the group", and the commoner case is INSIDE it: any child
 * that forks and exits is reaped while the grandchild holds the pipes. The gate
 * then skipped the kill and the survivor lived on — round 22's finding 1
 * verbatim, and the suite ENFORCED it (three fake-child tests asserted the
 * group form was not used, and nothing asserted the absence of the orphan).
 *
 * Measured with the same grandchild under the same 400ms ceiling, the only
 * difference being whether `sh` had already exited:
 *
 *   child reaped, grandchild in group -> survivor wrote its witness 2s later
 *   child alive,  grandchild in group -> survivor killed
 */
describe("createRealProcessProbe — a reaped child must not shelter its children", () => {
  it.each([
    ["the direct child has already exited (reaped)", "{ sleep 2; : > 'W'; } & exit 0"],
    ["the direct child is still running", "{ sleep 2; : > 'W'; } & wait"],
  ])(
    "kills the grandchild when %s",
    async (_name, template) => {
      const { mkdtemp, rm, access } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");

      const dir = await mkdtemp(join(tmpdir(), "eo-probe-reaped-"));
      try {
        const witness = join(dir, "survivor");
        const probe = createRealProcessProbe();

        const result = await probe("sh", ["-c", template.replace("W", witness)], {
          timeoutMs: 300,
        });
        expect(result.exitCode).toBe(-1);

        await new Promise((resolve) => setTimeout(resolve, 2600));
        await expect(access(witness)).rejects.toThrow();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    20_000,
  );
});

/**
 * Roast round 24 — the signal handler destroyed every OTHER handler.
 *
 * `process.removeAllListeners(signal)` plus a synchronous re-raise inside the
 * same emission aborted any other listener's async shutdown, whether it had
 * registered before us or after. `boot-supervisor.ts` registers exactly that
 * shape (`await composed.close(); await lease.release()`), so a SIGTERM would
 * have left the lease held and the socket open the moment the daemon ran a
 * bounded probe. Measured with one bounded probe as the only difference:
 * `gracefulShutdownCompleted: true` became `false`.
 */
describe("createRealProcessProbe — the signal handler must not evict other handlers", () => {
  it("leaves a pre-existing listener installed and lets it decide the exit", async () => {
    const probe = createRealProcessProbe();
    const other = (): void => undefined;
    process.on("SIGHUP", other);
    try {
      await probe("sh", ["-c", "exit 0"], { timeoutMs: 5_000 });

      // Our handler is installed alongside, not instead of.
      expect(process.listenerCount("SIGHUP")).toBeGreaterThanOrEqual(2);

      // Emitting the signal must run OUR sweep without removing THEIR listener,
      // and must not kill this process — someone else is still handling it.
      process.emit("SIGHUP");
      expect(process.listeners("SIGHUP")).toContain(other);
    } finally {
      process.off("SIGHUP", other);
    }
  });

  it("forwards SIGQUIT too, which Ctrl-\\ generates exactly like SIGINT", async () => {
    const probe = createRealProcessProbe();
    await probe("sh", ["-c", "exit 0"], { timeoutMs: 5_000 });

    // Round 24 measured SIGQUIT as the one interactive signal that still
    // orphaned the probe child.
    expect(process.listenerCount("SIGQUIT")).toBeGreaterThan(0);
  });
});

/**
 * Roast round 25, finding 3 — the sweep was ONE-SHOT.
 *
 * `process.off(signal, handler)` ran unconditionally and
 * `signalHandlersInstalled` is a sticky module flag, so a process that SURVIVES
 * the signal — which the `listenerCount` guard exists to allow — lost the sweep
 * permanently. Measured with a daemon whose SIGHUP handler reloads rather than
 * exits: probe #1's child was swept; probe #2, started after the first SIGHUP,
 * survived the second. `boot-supervisor.ts` registers exactly that shape.
 */
describe("createRealProcessProbe — the sweep must survive a signal the process survives", () => {
  it("keeps its handler installed when someone else is handling the signal", async () => {
    const probe = createRealProcessProbe();
    const other = (): void => undefined;
    process.on("SIGHUP", other);
    try {
      await probe("sh", ["-c", "exit 0"], { timeoutMs: 5_000 });
      const before = process.listenerCount("SIGHUP");
      expect(before).toBeGreaterThanOrEqual(2);

      // Someone else is listening, so the process survives -- and our handler
      // must still be there for the NEXT signal.
      process.emit("SIGHUP");
      expect(process.listenerCount("SIGHUP")).toBe(before);

      // Twice, because a one-shot handler passes a single round.
      process.emit("SIGHUP");
      expect(process.listenerCount("SIGHUP")).toBe(before);
    } finally {
      process.off("SIGHUP", other);
    }
  });
});

/**
 * Roast round 25, finding 4 — deleting `process.off(signal, handler)` survived
 * all 26 tests, and its absence is not cosmetic: without it the re-raise
 * re-enters our own handler instead of terminating, so an interrupted run
 * became a substantive FAILING HEALTH VERDICT rather than an interruption.
 *
 * ```
 * unmutated: SIGINT -> rc=130 (128+2), 0 survivors
 * mutant:    SIGINT -> rc=2, "✗ sandbox.selftest: the sandboxed shell never
 *                             reported running (exit -1)"
 * ```
 */
describe("createRealProcessProbe — an interrupted run must exit as interrupted", () => {
  it("re-raises the signal so the exit status is 128+signum", async () => {
    const { spawn: spawnHelper } = await import("node:child_process");
    const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const dir = await mkdtemp(join(tmpdir(), "eo-reraise-"));
    try {
      const here = fileURLToPath(new URL(".", import.meta.url));
      const modulePath = resolve(here, "process-probe.ts");
      const helper = join(dir, "helper.mts");
      await writeFile(
        helper,
        `import { createRealProcessProbe } from ${JSON.stringify(modulePath)};\n` +
          `const probe = createRealProcessProbe();\n` +
          `probe("sh", ["-c", "sleep 30"], { timeoutMs: 60000 });\n` +
          `setTimeout(() => { process.stdout.write("ready\\n"); }, 400);\n` +
          `setTimeout(() => {}, 60000);\n`,
      );

      // ROUND 25: `node_modules/.bin/tsx` is a WRAPPER PROCESS, so a signal
      // sent here landed on tsx and the test measured tsx's disposition rather
      // than the probe's. Deleting the re-raise from the product left it green.
      // `node --import tsx` loads the same TypeScript in ONE process, which is
      // the process under test.
      const child = spawnHelper(process.execPath, ["--import", "tsx", helper], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      await new Promise<void>((done) => {
        child.stdout.on("data", (chunk: Buffer) => {
          if (chunk.toString("utf8").includes("ready")) done();
        });
      });

      const outcome = await new Promise<{ code: number | null; signal: string | null }>((done) => {
        child.on("close", (code, signal) => done({ code, signal }));
        child.kill("SIGINT");
      });

      // Either the shell-visible 130, or death by the re-raised signal itself.
      // What must NOT happen is a clean, ordinary exit code.
      expect(outcome.signal === "SIGINT" || outcome.code === 130).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 25_000);
});
