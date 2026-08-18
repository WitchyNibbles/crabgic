import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CONVENTIONAL_LCOV_PATH } from "@crabgic/gates";

/**
 * A worktree fixture that models a genuine RED → GREEN transition, for suites
 * that drive the composed daemon end to end.
 *
 * ⚠️ WHY THESE SUITES NEEDED ONE. The composed registry now registers the TDD
 * gate (`../daemon/compose-gate-registry.ts`), and that gate is satisfied only
 * by a red-baseline `EvidenceRecord` captured before dispatch PLUS a candidate
 * that is now green. The harness produces both by actually running the
 * envelope's granted `acceptance` command in the attempt's worktree — so a
 * suite whose injected `createAttemptWorktree` returns a path that is not a
 * real directory can no longer reach publication, and should not be able to.
 *
 * The mechanism is one marker file. The declared test command asks whether it
 * exists, so the SAME command answers differently before and after the work:
 *
 *   - at base, the marker is absent → non-zero → the producer captures a red
 *     baseline, which is what the gate requires;
 *   - once {@link markFixtureWorktreeGreen} has run, the marker exists → clean
 *     exit → the gate's candidate run is the green half.
 *
 * The marker stands in for the edit a real worker would make. These suites
 * script a fake engine that writes nothing, so without it there is no moment at
 * which the tree changes and no honest way for a suite to model the transition
 * the gate exists to check. Flipping it from a git effect keeps the ordering
 * real: it happens after the attempt, before verification.
 *
 * ⚠️ IT ALSO EMITS A COVERAGE REPORT. The coverage gate refuses a candidate it
 * could not measure, so a fixture whose command leaves no `coverage/lcov.info`
 * cannot reach publication either. The report is written by the same command
 * whose exit status the TDD gate reads, which is exactly how a real project
 * works — one test invocation, two pieces of evidence.
 *
 * NOT A BYPASS. The command genuinely runs, in a genuine directory, through the
 * same child-process path production uses; only the reason it changes verdict
 * is fixture-supplied. A helper that stubbed the RUNNER would let these suites
 * pass against a daemon that executes nothing, which is the harness-only reach
 * this whole change set exists to end.
 */

/** The file the fixture's declared test command looks for. Its presence IS the green condition. */
export const FIXTURE_GREEN_MARKER = ".crabgic-fixture-green";

/**
 * Creates `worktreePath` (and its parents) carrying a real `package.json` whose
 * `test` script exits non-zero until {@link markFixtureWorktreeGreen} runs.
 *
 * `npm run test` is used verbatim because that is the string
 * `GRANTABLE_COMMAND_PREFIXES` classifies `acceptance`
 * (`@crabgic/contracts`) — the fixture has to be granted the same command
 * production is, or it would be testing a path no envelope can authorize.
 */
export async function createTddFixtureWorktree(worktreePath: string): Promise<string> {
  await mkdir(worktreePath, { recursive: true });
  await writeFile(
    join(worktreePath, "package.json"),
    JSON.stringify(
      {
        name: "crabgic-tdd-fixture",
        private: true,
        scripts: {
          /**
           * Two things, because two gates read this one command's effects: the
           * exit status is the TDD gate's red/green signal, and the lcov report
           * it emits is the coverage gate's input. Written on every run, so it
           * always describes the tree as it stands rather than a stale pass.
           */
          test: `test -f ${FIXTURE_GREEN_MARKER} && mkdir -p coverage && printf 'SF:src/fixture.ts\\nDA:1,1\\nBRDA:1,0,0,1\\nend_of_record\\n' > ${CONVENTIONAL_LCOV_PATH}`,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return worktreePath;
}

/** Writes the marker, so the fixture's declared test command starts exiting clean. */
export async function markFixtureWorktreeGreen(worktreePath: string): Promise<void> {
  await writeFile(join(worktreePath, FIXTURE_GREEN_MARKER), "green\n", "utf8");
}
