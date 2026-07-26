import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PERFORMANCE_OUTCOMES, type PerformanceOutcome } from "@eo/contracts";
import { probeQuietHost, type QuietHostAssessment } from "./quietHost.js";
import {
  PERFORMANCE_RERUN_RECORD_ENV,
  PERFORMANCE_RERUN_RECORD_PATH,
  PerformanceRerunRecordSchema,
  type PerformanceRerunRecord,
} from "./performanceContracts.js";

const execFileAsync = promisify(execFile);

/**
 * THE PRODUCER for roadmap/23:75 — "Re-run on a quiet host for the
 * release-candidate's real verdicts".
 *
 * WHY THIS DID NOT EXIST, AND WHY THAT MATTERED. `performanceContracts.ts`
 * has read `perf-contract-rerun.json` since it was written, blocking the
 * `performance-contracts` checklist item while the record is absent — and
 * NOTHING in this repository ever wrote one. `.github/workflows/
 * perf-conformance.yml` runs 15's fixture matrix on every push, but it
 * archives no record and the release gate never sees it, so the item failed
 * for want of an artifact no code path could produce. That is the same
 * consumer-without-producer shape the ARM64 loop had before its ingest step
 * existed, inverted: there the producer existed and the consumer did not.
 *
 * WHAT "THE EXACT ENTRY POINT" IS, per the roadmap rather than invention.
 * `roadmap/15-performance-contracts.md:112` settles it in as many words:
 * "`perf-conformance` runs as a standalone, named CI job invocable without
 * the full release harness — **the exact entry point 23 re-runs**".
 * `roadmap/23:26` says the same from the other side: "seeded-fault matrices
 * from 14/15/22 executed on the frozen release-candidate object ID, not a
 * synthetic fixture". So this module re-invokes that suite — which drives
 * 15's real `runTwinWorktreeBenchmark` and its real `decide()` engine — at
 * the candidate being cut, and records what the engine actually returned.
 *
 * WHAT THE RECORD DOES AND DOES NOT CLAIM. It claims: on a verified-quiet
 * host, at this object ID, 15's decision engine produced each declared
 * outcome. It does not claim a wall-clock number for the shipped binary;
 * that is 05's idle budget, which `performanceContracts.ts` measures
 * separately and which `roadmap/15:38` explicitly keeps out of
 * `packages/perf`. The two obligations stay two, exactly as roadmap/23
 * books them.
 *
 * THE SUITE IS THE ORACLE. Each fixture asserts the outcome 15's engine must
 * produce for it, so a green suite IS the statement "every declared outcome
 * was the outcome produced". A red suite therefore produces NO record at
 * all rather than a record with softened outcomes — an unproduced record is
 * reported by the consumer as the honest "no 15 re-run evidence", while a
 * record claiming outcomes the run did not observe would be a false green
 * that no downstream check could detect.
 */

/** The standalone entry point `roadmap/15:112` names as the one 23 re-runs. */
export const PERF_CONFORMANCE_SUITE = "packages/perf/src/conformance/perf-conformance.test.ts";

/** What the `runner` field records — the provenance of the verdicts, not a label. */
export const PERF_RERUN_RUNNER =
  "packages/perf perf-conformance fixture matrix (roadmap/15:112's standalone entry point), " +
  "driving 15's runTwinWorktreeBenchmark + decide() engine";

/**
 * The one contract this record carries.
 *
 * WHY ONE, AND WHY NOT ONE PER FIXTURE. The first version of this module
 * recorded a contract per seeded fixture, carrying each fixture's own
 * asserted outcome — `block` for the 20%-regression fixture,
 * `inconclusive_blocking` for the noisy one. Running it against the real
 * consumer showed that to be a category error, and the consumer was right to
 * reject it: `checkPerformanceContracts` reads `contracts[].outcome` as *the
 * release candidate's* PerformanceContract verdicts, where `block` means "a
 * regression was found in what we are shipping". The fixtures' `block` and
 * `inconclusive_blocking` mean the opposite — they are the CORRECT decisions
 * on deliberately seeded faults, and 15's engine failing to produce them
 * would be the defect. Feeding them through as release verdicts made a green
 * conformance run read as two blocked contracts.
 *
 * What 23:75 actually wants evidenced is therefore a single proposition:
 * at this object ID, on a quiet host, 15's decision engine decided every
 * seeded fixture the way it must. That is one contract, and it is `pass` or
 * there is no record at all.
 */
export const PERF_RERUN_CONTRACT_ID = "perf-conformance-matrix";

/**
 * The seeded fixtures the matrix decides, each with the outcome 15's engine
 * must produce for it.
 *
 * These are the INPUTS to the contract above, not contracts themselves — see
 * {@link PERF_RERUN_CONTRACT_ID}. They are declared here so the set is
 * documented and drift-guarded: `perfContractRerun.test.ts` binds every entry
 * to a real `it(...)` title in {@link PERF_CONFORMANCE_SUITE}, so a renamed,
 * added or deleted fixture goes red instead of quietly shrinking what the
 * release re-runs.
 */
export const PERF_CONFORMANCE_FIXTURES: readonly {
  readonly contractId: string;
  readonly outcome: PerformanceOutcome;
  readonly fixtureTitle: string;
}[] = [
  {
    contractId: "perf-conformance/cpu-regression-20pct-sensitive",
    outcome: "block",
    fixtureTitle: "fixture 1: a 20% CPU regression on a sensitive path BLOCKS",
  },
  {
    contractId: "perf-conformance/noise-level-3pct-critical",
    outcome: "pass",
    fixtureTitle: "fixture 2: a 3% regression (within noise/threshold) on a critical path PASSES",
  },
  {
    contractId: "perf-conformance/noisy-critical-measurement",
    outcome: "inconclusive_blocking",
    fixtureTitle:
      "fixture 3: a noisy critical-path measurement is INCONCLUSIVE and BLOCKING (never quarantined-as-passing)",
  },
];

/** Injectable seam over the real suite invocation — mirrors `publicationCheck.ts`'s real/fake split. */
export interface PerfConformanceRunner {
  run(repoRoot: string): Promise<{ readonly exitCode: number; readonly output: string }>;
}

/** The real runner: invokes the suite exactly as `perf-conformance.yml` does. */
export const realPerfConformanceRunner: PerfConformanceRunner = {
  async run(repoRoot) {
    try {
      const { stdout, stderr } = await execFileAsync(
        "npx",
        ["vitest", "run", PERF_CONFORMANCE_SUITE, "--coverage.enabled=false"],
        { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 },
      );
      return { exitCode: 0, output: `${stdout}\n${stderr}` };
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      return {
        exitCode: failure.code ?? 1,
        output: `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`,
      };
    }
  },
};

export interface ProducePerfRerunOptions {
  readonly repoRoot: string;
  readonly releaseCandidateObjectId: string;
  readonly capturedAt: string;
  readonly runner?: PerfConformanceRunner;
  readonly quietHost?: QuietHostAssessment;
}

/**
 * A record, or a stated reason there is none. Deliberately a union, matching
 * `PerformanceRerunEvidence`'s own shape: "no record and no explanation why"
 * must not be representable on the producing side either.
 */
export type PerfRerunProduction =
  | { readonly record: PerformanceRerunRecord; readonly refusal?: undefined }
  | { readonly record?: undefined; readonly refusal: string };

/**
 * Runs the matrix and produces the record, or refuses with a reason.
 *
 * REFUSES ON A NOISY HOST rather than recording `quietHost: false` and
 * letting the consumer decide: 23:75 says "on a quiet host", and the
 * consumer already rejects a record whose `quietHost` is false. Emitting one
 * we know will be rejected would turn a measurement problem into a spurious
 * release blocker whose reason points at the wrong thing.
 */
export async function producePerfContractRerun(
  options: ProducePerfRerunOptions,
): Promise<PerfRerunProduction> {
  // QUIESCENCE IS MEASURED ACROSS THE RUN, not sampled before it.
  // `probeQuietHost` opens an interval and `finish()` judges the whole span,
  // which is the question 23:75 actually asks — a host that was idle the
  // instant before the matrix started and saturated throughout it was not a
  // quiet host to have measured on. The injected `quietHost` seam skips the
  // probe entirely so both verdicts stay testable on any host.
  const sampler = options.quietHost === undefined ? await probeQuietHost() : undefined;

  const runner = options.runner ?? realPerfConformanceRunner;
  const { exitCode, output } = await runner.run(options.repoRoot);

  const quietHost = options.quietHost ?? (await sampler!.finish());

  // The matrix verdict is reported first when both are bad: "15's engine
  // decided wrongly at this commit" is the more actionable finding, and a
  // busy host does not explain a wrong decision.
  if (exitCode !== 0) {
    return {
      refusal:
        `${PERF_CONFORMANCE_SUITE} exited ${String(exitCode)} — 15's decision engine did not ` +
        "produce every declared outcome at this release candidate, so no re-run record is " +
        `written. Last output:\n${output.trim().slice(-2000)}`,
    };
  }

  if (!quietHost.quiet) {
    return {
      refusal:
        `host was not quiet across the re-run (load/core ${quietHost.loadPerCore.toFixed(2)}, ` +
        `idle ${(quietHost.idleFraction * 100).toFixed(1)}%): ${quietHost.reasons.join(" ")} ` +
        "roadmap/23:75 requires the re-run be taken on a quiet host, and a record taken on a " +
        "busy one is not the evidence it asks for.",
    };
  }

  // Built through the schema rather than merely typed, so a producer/consumer
  // drift is caught here — at the point of writing — instead of at the gate.
  return {
    record: PerformanceRerunRecordSchema.parse({
      releaseCandidateObjectId: options.releaseCandidateObjectId,
      runner: PERF_RERUN_RUNNER,
      quietHost: true,
      capturedAt: options.capturedAt,
      // One contract, `pass`, and only reachable because the suite was green
      // — see PERF_RERUN_CONTRACT_ID for why this is not one entry per
      // seeded fixture.
      contracts: [{ contractId: PERF_RERUN_CONTRACT_ID, outcome: "pass" }],
    }),
  };
}

/** Re-exported so the CLI and the workflow name the same constants the consumer does. */
export { PERFORMANCE_RERUN_RECORD_ENV, PERFORMANCE_RERUN_RECORD_PATH, PERFORMANCE_OUTCOMES };
