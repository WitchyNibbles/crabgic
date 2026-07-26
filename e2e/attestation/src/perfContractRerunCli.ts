import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PERFORMANCE_RERUN_RECORD_ENV,
  PERFORMANCE_RERUN_RECORD_PATH,
  producePerfContractRerun,
} from "./perfContractRerun.js";

/**
 * CLI for the 23:75 re-run producer — the half `.github/workflows/
 * release-e2e.yml` invokes, and the one `npm run probe:perf-contract-rerun`
 * exposes locally.
 *
 * WHERE IT WRITES, and why it is not simply the in-repo path: the record
 * names the release-candidate object ID it was taken against, and committing
 * it advances `HEAD` past that very object ID — the catch-22
 * `docs/interface-ledger.md`'s Gap 16 exists to resolve. `$EO_PERF_CONTRACT_
 * RERUN_RECORD` therefore wins when set (CI points it at `$RUNNER_TEMP`),
 * and the in-repo path is the fallback for a record archived alongside the
 * release for post-hoc audit.
 *
 * EXIT STATUS IS THE PRODUCTION VERDICT, not the release verdict. `0` means
 * a record was written; `1` means the producer refused and said why — a red
 * matrix or a busy host. The refusal is deliberately NOT fatal to the
 * release job that calls it: an absent record is an input the gate already
 * knows how to report ("no 15 re-run evidence"), whereas a job that dies
 * here takes every other item's evidence down with it.
 */
async function main(): Promise<number> {
  const repoRoot = resolve(join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."));

  const objectId =
    process.env["EO_RELEASE_CANDIDATE_OBJECT_ID"] ??
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf-8" }).trim();

  const override = process.env[PERFORMANCE_RERUN_RECORD_ENV];
  const outputPath =
    override === undefined || override.trim() === ""
      ? join(repoRoot, PERFORMANCE_RERUN_RECORD_PATH)
      : override;

  process.stdout.write(`[perf-contract-rerun] release candidate: ${objectId}\n`);
  process.stdout.write(
    "[perf-contract-rerun] probing host quiescence, then re-running the matrix\n",
  );

  const produced = await producePerfContractRerun({
    repoRoot,
    releaseCandidateObjectId: objectId,
    capturedAt: new Date().toISOString(),
  });

  if (produced.record === undefined) {
    process.stderr.write(`[perf-contract-rerun] REFUSED: ${produced.refusal}\n`);
    return 1;
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(produced.record, null, 2)}\n`, "utf-8");
  process.stdout.write(`[perf-contract-rerun] wrote ${outputPath}\n`);
  for (const contract of produced.record.contracts) {
    process.stdout.write(`[perf-contract-rerun]   ${contract.contractId}: ${contract.outcome}\n`);
  }
  return 0;
}

process.exitCode = await main();
