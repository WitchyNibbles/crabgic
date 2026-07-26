import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PERFORMANCE_OUTCOMES } from "@eo/contracts";
import {
  PERF_CONFORMANCE_SUITE,
  PERF_CONFORMANCE_FIXTURES,
  PERF_RERUN_CONTRACT_ID,
  PERF_RERUN_RUNNER,
  producePerfContractRerun,
  type PerfConformanceRunner,
} from "./perfContractRerun.js";
import {
  PerformanceRerunRecordSchema,
  checkPerformanceContracts,
  readPerformanceRerunEvidence,
  PERFORMANCE_RERUN_RECORD_ENV,
} from "./performanceContracts.js";
import type { QuietHostAssessment } from "./quietHost.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const QUIET: QuietHostAssessment = {
  quiet: true,
  loadPerCore: 0.01,
  idleFraction: 0.99,
  reasons: [],
};
const NOISY: QuietHostAssessment = {
  quiet: false,
  loadPerCore: 3.4,
  idleFraction: 0.12,
  reasons: ["1-minute load average is 3.40 per core, above the 0.5 quiet-host limit."],
};

function runner(exitCode: number, output = ""): PerfConformanceRunner {
  return { run: () => Promise.resolve({ exitCode, output }) };
}

const BASE = {
  repoRoot: REPO_ROOT,
  releaseCandidateObjectId: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  capturedAt: "2026-07-26T00:00:00.000Z",
};

describe("producePerfContractRerun — the record it writes", () => {
  it("produces a schema-valid record when the matrix is green on a quiet host", async () => {
    const result = await producePerfContractRerun({ ...BASE, quietHost: QUIET, runner: runner(0) });
    expect(result.refusal).toBeUndefined();
    expect(() => PerformanceRerunRecordSchema.parse(result.record)).not.toThrow();
  });

  it("records the candidate it was actually taken against", async () => {
    const result = await producePerfContractRerun({ ...BASE, quietHost: QUIET, runner: runner(0) });
    expect(result.record?.releaseCandidateObjectId).toBe(BASE.releaseCandidateObjectId);
  });

  it("names what produced the verdicts, not a bare label", async () => {
    const result = await producePerfContractRerun({ ...BASE, quietHost: QUIET, runner: runner(0) });
    expect(result.record?.runner).toBe(PERF_RERUN_RUNNER);
    expect(result.record?.runner).toContain("perf-conformance");
  });

  /**
   * The category error this pins against: `contracts[].outcome` is read by
   * `checkPerformanceContracts` as the RELEASE CANDIDATE's verdict, where
   * `block` means "a regression was found in what we ship". The seeded
   * fixtures' own `block`/`inconclusive_blocking` are the CORRECT decisions
   * on deliberately planted faults. An earlier revision passed them straight
   * through, and a fully green conformance run read at the gate as two
   * blocked contracts.
   */
  it("records ONE contract for the matrix, never the seeded fixtures' own outcomes", async () => {
    const result = await producePerfContractRerun({ ...BASE, quietHost: QUIET, runner: runner(0) });
    expect(result.record?.contracts).toEqual([
      { contractId: PERF_RERUN_CONTRACT_ID, outcome: "pass" },
    ]);
    for (const contract of result.record?.contracts ?? []) {
      expect(PERFORMANCE_OUTCOMES).toContain(contract.outcome);
    }
  });

  it("never leaks a seeded fixture's block/inconclusive verdict into the record", async () => {
    const result = await producePerfContractRerun({ ...BASE, quietHost: QUIET, runner: runner(0) });
    const outcomes = (result.record?.contracts ?? []).map((contract) => contract.outcome);
    expect(outcomes).not.toContain("block");
    expect(outcomes).not.toContain("inconclusive_blocking");
  });

  it("is accepted by the consumer as a satisfied re-run, not a blocked one", async () => {
    const result = await producePerfContractRerun({ ...BASE, quietHost: QUIET, runner: runner(0) });
    // The REAL consumer, given an otherwise-clean idle measurement: the only
    // thing under test here is whether the produced record clears 23:75.
    const verdict = checkPerformanceContracts({
      decisions: [
        {
          contractId: "supervisor-idle-rss",
          metric: "peak_rss",
          outcome: "pass",
          statistic: "max sampled current RSS",
          observed: 1,
          absoluteBudget: 2,
          sampleCount: 60,
          observedSpanMs: 16_000,
        },
      ] as never,
      quietHost: QUIET,
      failures: [],
      rerunEvidence: {
        releaseCandidateObjectId: BASE.releaseCandidateObjectId,
        record: result.record,
      } as never,
    });
    expect(verdict.reasons).toEqual([]);
    expect(verdict.verdict).toBe("PASS");
  });

  it("is the record the CONSUMER accepts — producer and consumer agree on the shape", async () => {
    const result = await producePerfContractRerun({ ...BASE, quietHost: QUIET, runner: runner(0) });
    // Round-trip through the reader the release gate actually uses.
    const saved = process.env[PERFORMANCE_RERUN_RECORD_ENV];
    try {
      const { mkdtempSync, writeFileSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const path = join(mkdtempSync(join(tmpdir(), "eo-perf-rerun-")), "perf-contract-rerun.json");
      writeFileSync(path, `${JSON.stringify(result.record, null, 2)}\n`, "utf-8");
      process.env[PERFORMANCE_RERUN_RECORD_ENV] = path;

      const read = readPerformanceRerunEvidence(REPO_ROOT, BASE.releaseCandidateObjectId);
      expect(read.unavailable).toBeUndefined();
      expect(read.record?.contracts).toHaveLength(1);
    } finally {
      if (saved === undefined) delete process.env[PERFORMANCE_RERUN_RECORD_ENV];
      else process.env[PERFORMANCE_RERUN_RECORD_ENV] = saved;
    }
  });
});

describe("producePerfContractRerun — it refuses rather than softening", () => {
  it("writes NO record when the matrix is red, and says why", async () => {
    const result = await producePerfContractRerun({
      ...BASE,
      quietHost: QUIET,
      runner: runner(1, "fixture 1 failed"),
    });
    expect(result.record).toBeUndefined();
    expect(result.refusal).toContain("did not produce every declared outcome");
  });

  it("never rewrites a failing run's outcomes into a passing record", async () => {
    const result = await producePerfContractRerun({
      ...BASE,
      quietHost: QUIET,
      runner: runner(1),
    });
    expect(JSON.stringify(result)).not.toContain('"contracts"');
  });

  it("refuses on a noisy host — 23:75 asks for a quiet one", async () => {
    const result = await producePerfContractRerun({ ...BASE, quietHost: NOISY, runner: runner(0) });
    expect(result.record).toBeUndefined();
    expect(result.refusal).toContain("was not quiet");
    expect(result.refusal).toContain("above the 0.5 quiet-host limit");
  });

  it("quotes the failing output so the refusal is actionable", async () => {
    const result = await producePerfContractRerun({
      ...BASE,
      quietHost: QUIET,
      runner: runner(2, "AssertionError: expected block to be pass"),
    });
    expect(result.refusal).toContain("AssertionError");
  });
});

/**
 * DRIFT GUARD. The declared contract set is only meaningful if each entry
 * corresponds to a fixture that really exists in the suite being re-run. A
 * renamed or deleted fixture would otherwise leave the release recording an
 * outcome nothing produced.
 */
describe("the declared contracts are bound to the real perf-conformance suite", () => {
  const suite = readFileSync(join(REPO_ROOT, PERF_CONFORMANCE_SUITE), "utf-8");

  it("finds the suite at the path roadmap/15:112 names", () => {
    expect(suite.length).toBeGreaterThan(0);
  });

  for (const contract of PERF_CONFORMANCE_FIXTURES) {
    it(`${contract.contractId} matches a real fixture in the suite`, () => {
      expect(suite).toContain(contract.fixtureTitle);
    });
  }

  it("declares a distinct contractId per fixture", () => {
    const ids = PERF_CONFORMANCE_FIXTURES.map((contract) => contract.contractId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is non-empty — an empty re-run is not a re-run", () => {
    expect(PERF_CONFORMANCE_FIXTURES.length).toBeGreaterThan(0);
  });
});

/**
 * Producer/consumer binding for the 23:75 loop, against the REAL workflow
 * file. A producer no workflow invokes is unreachable machinery, and
 * `performance-contracts` would go on reporting the obligation as
 * unevidenced with every test still green.
 */
describe("release-e2e.yml invokes the producer this module exposes", () => {
  const workflow = readFileSync(
    join(REPO_ROOT, ".github", "workflows", "release-e2e.yml"),
    "utf-8",
  );

  it("runs the re-run producer", () => {
    expect(workflow).toContain("probe:perf-contract-rerun");
  });

  it("points the record outside the checked-out tree (Gap 16)", () => {
    expect(workflow).toMatch(
      new RegExp(`${PERFORMANCE_RERUN_RECORD_ENV}:\\s*\\$\\{\\{\\s*runner\\.temp\\s*\\}\\}`),
    );
  });

  it("exports it to later steps, so the attestation harness reads the same path", () => {
    expect(workflow).toMatch(
      new RegExp(
        `echo "${PERFORMANCE_RERUN_RECORD_ENV}=\\$${PERFORMANCE_RERUN_RECORD_ENV}" >> "\\$GITHUB_ENV"`,
      ),
    );
  });

  it("is wired as an npm script, so the workflow and a developer run the same thing", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["probe:perf-contract-rerun"]).toContain("perfContractRerunCli.ts");
  });
});
