import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runKillHarness } from "../kill-harness.js";
import { createNodeFsPort } from "../store/fs-port.js";
import { listSegmentIndexes } from "../store/segment-layout.js";
import { resolveStoreConfig } from "../store/store-config.js";
import { createPrng, type IterationPlan } from "./plan.js";
import { prepareCrashSuiteRuntime, type FixtureRuntime } from "./prepare-runtime.js";
import { APPEND_STEP_POINT_NAMES } from "./signaling-fs-port.js";
import { verifyAppendRecovery } from "./verify-recovery.js";

/**
 * VALIDATION ROUND (2026-07-18), MAJOR 1 finding: "The 1000-iteration crash
 * suite NEVER rotates segments, so the multi-segment path had zero
 * coverage (green was vacuous for rotated journals)." This file closes
 * that gap: `EO_CRASH_FIXTURE_SEGMENT_MAX_BYTES=1` forces a fresh segment
 * on every single append (mirroring `append-entry.test.ts`'s own "rotates
 * to a new segment once the size threshold is crossed" unit test), so
 * every real kill in this variant genuinely exercises the multi-segment
 * append/repair path — `verifyAppendRecovery` (`./verify-recovery.js`,
 * shared with `crash-suite.test.ts`'s original variant) is reused
 * unchanged, proving it is correct for BOTH the single- and multi-segment
 * case with the same verifier. Split into its own file (alongside
 * `crash-suite.test.ts`) to keep both under this repo's 400-line-file
 * convention.
 */
const ROTATION_ITERATION_COUNT = Number(process.env["EO_CRASH_SUITE_ROTATION_ITERATIONS"] ?? "30");
const ROTATION_SEGMENT_MAX_BYTES = "1";
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
  const dir = mkdtempSync(join(tmpdir(), "eo-crash-suite-rotation-"));
  dirsToClean.push(dir);
  return dir;
}

/**
 * Append-only plan builder — every plan's `faultPoint` is drawn from
 * `APPEND_STEP_POINT_NAMES` only (this variant never runs snapshot mode).
 * `entryCountBefore` is offset by 3: with `segmentMaxBytes=1`, each prior
 * entry already lands in its own segment, so this guarantees several real
 * rotations happen before the armed (killed) entry's own append.
 */
function buildAppendOnlyRotationPlans(count: number, seed: number): IterationPlan[] {
  const pick = createPrng(seed);
  const plans: IterationPlan[] = [];
  const allNames: readonly string[] = ["before-append", ...APPEND_STEP_POINT_NAMES];
  for (let i = 0; i < count; i++) {
    const faultPoint = allNames[pick(allNames.length)]!;
    const entryCountBefore = pick(3) + 3;
    plans.push({ dir: freshDir(), mode: "append", entryCountBefore, faultPoint });
  }
  return plans;
}

describe("crash suite — SEGMENT ROTATION variant (VALIDATION ROUND 2026-07-18, MAJOR 1 regression coverage)", () => {
  it(
    "recovery always converges with zero undetected corruption across randomized real kill iterations over a genuinely re-rotating append path",
    async () => {
      const stderrChunks: string[] = [];
      const seed = Number(process.env["EO_CRASH_SUITE_ROTATION_SEED"] ?? "987654321");
      const plans = buildAppendOnlyRotationPlans(ROTATION_ITERATION_COUNT, seed);
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
            env: { EO_CRASH_FIXTURE_SEGMENT_MAX_BYTES: ROTATION_SEGMENT_MAX_BYTES },
          };
        },
        faultPoints,
        {
          verify: (ctx) => {
            const plan = plans[ctx.attemptIndex]!;
            return verifyAppendRecovery(plan.dir, plan.entryCountBefore);
          },
          spawnTimeoutMs: 10_000,
          onOperationOutput: (text, stream) => {
            if (stream === "stderr") stderrChunks.push(text);
          },
        },
      );

      // Sanity: prove this variant genuinely rotated (didn't silently
      // degenerate to the single-segment case) — at least one iteration's
      // surviving journal must span more than one segment file.
      const segmentCounts = await Promise.all(
        plans.map(async (plan) => {
          const config = resolveStoreConfig({ journalDir: plan.dir, fs: createNodeFsPort() });
          const indexes = await listSegmentIndexes(config.fs, config.segmentsDir);
          return indexes.length;
        }),
      );
      expect(
        Math.max(...segmentCounts),
        `expected at least one iteration to span multiple segments; counts: ${JSON.stringify(segmentCounts)}`,
      ).toBeGreaterThan(1);

      const failed = report.results.filter((r) => r.verdict === "fail");
      expect(
        failed,
        `rotation-variant crash-suite failures: ${JSON.stringify(failed, null, 2)}\nstderr:\n${stderrChunks.join("")}`,
      ).toHaveLength(0);
      expect(report.allConverged).toBe(true);
      expect(report.results).toHaveLength(ROTATION_ITERATION_COUNT);
    },
    Math.max(30_000, ROTATION_ITERATION_COUNT * 2_500),
  );
});
