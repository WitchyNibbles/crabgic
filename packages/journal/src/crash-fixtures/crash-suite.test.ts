import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runKillHarness, type KillHarnessOperationSpec } from "../kill-harness.js";
import { createPrng, type IterationPlan } from "./plan.js";
import { prepareCrashSuiteRuntime, type FixtureRuntime } from "./prepare-runtime.js";
import { APPEND_STEP_POINT_NAMES, SNAPSHOT_STEP_POINT_NAMES } from "./signaling-fs-port.js";
import { verifyAppendRecovery, verifySnapshotRecovery } from "./verify-recovery.js";

/**
 * roadmap/04-journal-idempotency-leases.md exit criterion 1: "1k randomized
 * kill-iteration run (`runKillHarness` over the append/chain/snapshot
 * path): zero undetected corruption; recovery always converges to the last
 * valid chained entry — evidence: `journal-crash-suite` CI job artifact."
 *
 * The default `numIterations` (25) keeps the normal `vitest run` fast; the
 * documented, committed 1k-scale (or largest-that-fits) evidence capture is
 * a ONE-TIME run with `EO_CRASH_SUITE_ITERATIONS` set, output redirected to
 * docs/evidence/phase-04/exit-criteria-crash-suite.txt — see this
 * package's phase-04 evidence README for the exact command and honest
 * iteration count actually achieved. VALIDATION ROUND (2026-07-18) fix,
 * MAJOR 1: this variant NEVER rotates segments (see
 * `crash-suite-rotation.test.ts` for the dedicated rotation variant added
 * to close that coverage gap) — `verifyAppendRecovery`/
 * `verifySnapshotRecovery` (`./verify-recovery.js`) are now whole-journal
 * aware regardless, so the same verifier serves both files.
 */
const ITERATION_COUNT = Number(process.env["EO_CRASH_SUITE_ITERATIONS"] ?? "25");
const SLEEP_MS = Number(process.env["EO_CRASH_SUITE_SLEEP_MS"] ?? "8");

const dirsToClean: string[] = [];
const runtimesToClean: FixtureRuntime[] = [];

afterEach(async () => {
  while (dirsToClean.length > 0) {
    rmSync(dirsToClean.pop()!, { recursive: true, force: true });
  }
  while (runtimesToClean.length > 0) {
    await runtimesToClean.pop()!.cleanup();
  }
});

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "eo-crash-suite-"));
  dirsToClean.push(dir);
  return dir;
}

/** One randomized plan per iteration: which mode (append/snapshot), how many real prior entries to establish first, and which single internal step to kill at — spanning every point in both the real append path (durablyAppendLine's 7 internal steps) and the real snapshot path (durablyWriteFileAtomic's 8). */
function buildPlans(count: number, seed: number): IterationPlan[] {
  const pick = createPrng(seed);
  const plans: IterationPlan[] = [];
  for (let i = 0; i < count; i++) {
    const mode: "append" | "snapshot" = pick(2) === 0 ? "append" : "snapshot";
    const stepNames = mode === "append" ? APPEND_STEP_POINT_NAMES : SNAPSHOT_STEP_POINT_NAMES;
    const beforeName = mode === "append" ? "before-append" : "before-snapshot";
    const allNames: readonly string[] = [beforeName, ...stepNames];
    const faultPoint = allNames[pick(allNames.length)]!;
    const entryCountBefore = pick(3);
    plans.push({ dir: freshDir(), mode, entryCountBefore, faultPoint });
  }
  return plans;
}

describe("crash suite — randomized real safe-path kill iterations (roadmap/04 exit criterion 1)", () => {
  it(
    "recovery always converges with zero undetected corruption across randomized real kill iterations over the append/snapshot path",
    async () => {
      const stderrChunks: string[] = [];
      const seed = Number(process.env["EO_CRASH_SUITE_SEED"] ?? "1234567891");
      const plans = buildPlans(ITERATION_COUNT, seed);
      const runtime = await prepareCrashSuiteRuntime("append-chain-snapshot-operation.ts");
      runtimesToClean.push(runtime);

      const faultPoints = plans.map((p) => p.faultPoint);

      const report = await runKillHarness(
        (ctx) => {
          const plan = plans[ctx.attemptIndex]!;
          return {
            command: process.execPath,
            args: [
              runtime.entryPath,
              plan.dir,
              String(plan.entryCountBefore),
              plan.mode,
              String(SLEEP_MS),
            ],
          };
        },
        faultPoints,
        {
          verify: (ctx) => {
            const plan = plans[ctx.attemptIndex]!;
            return plan.mode === "append"
              ? verifyAppendRecovery(plan.dir, plan.entryCountBefore)
              : verifySnapshotRecovery(plan.dir, plan.entryCountBefore);
          },
          spawnTimeoutMs: 10_000,
          onOperationOutput: (text, stream) => {
            if (stream === "stderr") stderrChunks.push(text);
          },
        },
      );

      const failed = report.results.filter((r) => r.verdict === "fail");
      expect(
        failed,
        `crash-suite failures: ${JSON.stringify(failed, null, 2)}\nstderr:\n${stderrChunks.join("")}`,
      ).toHaveLength(0);
      expect(report.allConverged).toBe(true);
      expect(report.results).toHaveLength(ITERATION_COUNT);
    },
    Math.max(30_000, ITERATION_COUNT * 2_500),
  );
});

describe("crash suite — harness corruption-detection self-check (proves the fault-injection scaffolding genuinely has teeth before it is trusted against the real path, mirroring work item 7's own unsafe/safe precedent)", () => {
  it("catches a seeded corruption class: a truncate+rewrite (no fsync, no atomicity) append variant loses previously-durable entries when killed mid-write", async () => {
    const dir = freshDir();
    const runtime = await prepareCrashSuiteRuntime("append-chain-snapshot-operation.ts");
    runtimesToClean.push(runtime);

    const spec: KillHarnessOperationSpec = {
      command: process.execPath,
      args: [runtime.entryPath, dir, "2", "append", String(SLEEP_MS)],
      env: { EO_CRASH_FIXTURE_BROKEN: "1" },
    };

    const report = await runKillHarness(spec, [...APPEND_STEP_POINT_NAMES.slice(0, 2)], {
      verify: () => verifyAppendRecovery(dir, 2),
    });

    expect(report.allConverged).toBe(false);
    expect(report.results.some((r) => r.verdict === "fail")).toBe(true);
  }, 30_000);
});
