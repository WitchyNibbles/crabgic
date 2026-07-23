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
