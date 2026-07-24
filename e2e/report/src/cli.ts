import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJournalStore } from "@eo/journal";
import { generateReleaseGateReport, type EvidenceJournalReader } from "./generator.js";
import {
  ReleaseGateReportSchema,
  type ReleaseGateReport,
  type ReleaseGateScoringMode,
} from "./schema.js";
import type { ReleaseGateChecklistItemSpec } from "./checklist.js";

/**
 * `.github/workflows/release-e2e.yml`'s actual entrypoint — mirrors
 * `packages/gates/src/drift/cli.ts`'s split ("the ONLY module ... that
 * touches real disk I/O"): `runReleaseGateReportCli` is the fully
 * dependency-injectable, unit-testable orchestration function; the
 * `process.exit`/`import.meta` glue at the bottom of this file is excluded
 * from coverage the same way that file's is.
 */

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
/** `e2e/report/src` (or `.../dist` once built) -> repo root is 3 levels up. */
const REPO_ROOT = join(THIS_DIR, "..", "..", "..");
/** `e2e/report/src` (or `.../dist`) -> `e2e/` is 2 levels up — roadmap/23's own pinned path, `e2e/release-gate-report.json`. */
export const DEFAULT_OUT_FILE = join(THIS_DIR, "..", "..", "release-gate-report.json");
/**
 * Deliberately OUTSIDE the repo tree (mirrors `packages/gates/src/drift/
 * cli.ts`'s own `DEFAULT_DEBOUNCE_STATE_PATH` rationale): until work items
 * 2-10 wire a real production journal location into this generator, a
 * bare local invocation must never invent an untracked directory inside
 * the repo working tree. CI overrides this via `EO_RELEASE_GATE_JOURNAL_DIR`
 * once a real journal path is available.
 */
export const DEFAULT_JOURNAL_DIR = join(tmpdir(), "eo-release-gate-report", "journal");

function resolveDefaultReleaseCandidateObjectId(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
}

function isScoringMode(value: string): value is ReleaseGateScoringMode {
  return value === "interim" || value === "final";
}

async function writeReportFile(path: string, report: ReleaseGateReport): Promise<void> {
  // Fail loudly (never silently persist a schema-invalid report) — the
  // archived file is this phase's audit trail; a shape violation here
  // must surface as a hard CLI failure, not a malformed artifact upload.
  const validated = ReleaseGateReportSchema.parse(report);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, "utf-8");
}

export interface RunReleaseGateReportCliOptions {
  readonly journalDir?: string;
  readonly releaseCandidateObjectId?: string;
  readonly scoringMode?: ReleaseGateScoringMode;
  readonly outFile?: string;
  /** Test-only override — skips constructing a real `@eo/journal` store. */
  readonly journal?: EvidenceJournalReader;
  readonly now?: () => string;
  /** Overridable so tests can exercise the CLI against a small synthetic checklist; defaults to the real 15-item `RELEASE_GATE_CHECKLIST`. */
  readonly checklist?: readonly ReleaseGateChecklistItemSpec[];
}

export interface RunReleaseGateReportCliResult {
  readonly report: ReleaseGateReport;
  readonly outFile: string;
}

/**
 * Reads env-var overrides (`EO_RELEASE_GATE_JOURNAL_DIR`,
 * `EO_RELEASE_CANDIDATE_OBJECT_ID`, `EO_RELEASE_GATE_MODE`,
 * `EO_RELEASE_GATE_OUT_FILE`) layered under explicit `options`, generates
 * the report, and archives it to `outFile`. Returns the generated report
 * so the CI-job glue (and tests) can inspect `overallVerdict` directly
 * without re-reading the file back.
 */
export async function runReleaseGateReportCli(
  options: RunReleaseGateReportCliOptions = {},
): Promise<RunReleaseGateReportCliResult> {
  const journalDir =
    options.journalDir ?? process.env["EO_RELEASE_GATE_JOURNAL_DIR"] ?? DEFAULT_JOURNAL_DIR;
  const releaseCandidateObjectId =
    options.releaseCandidateObjectId ??
    process.env["EO_RELEASE_CANDIDATE_OBJECT_ID"] ??
    resolveDefaultReleaseCandidateObjectId();
  const envMode = process.env["EO_RELEASE_GATE_MODE"];
  const scoringMode: ReleaseGateScoringMode =
    options.scoringMode ?? (envMode !== undefined && isScoringMode(envMode) ? envMode : "interim");
  const outFile = options.outFile ?? process.env["EO_RELEASE_GATE_OUT_FILE"] ?? DEFAULT_OUT_FILE;
  const journal = options.journal ?? createJournalStore({ journalDir });

  const report = await generateReleaseGateReport({
    journal,
    releaseCandidateObjectId,
    scoringMode,
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.checklist !== undefined ? { checklist: options.checklist } : {}),
  });

  await writeReportFile(outFile, report);

  return { report, outFile };
}

/* c8 ignore start -- process.exit / import.meta CLI entrypoint glue, not unit-testable logic. */
const isMainModule =
  process.argv[1]?.endsWith("cli.js") === true || process.argv[1]?.endsWith("cli.ts") === true;
if (isMainModule) {
  runReleaseGateReportCli()
    .then(({ report, outFile }) => {
      console.log(
        `release-gate-report: wrote ${outFile} — overallVerdict=${report.overallVerdict} ` +
          `(scoringMode=${report.scoringMode}, releaseCandidateObjectId=${report.releaseCandidateObjectId})`,
      );
      process.exit(report.overallVerdict === "FAIL" ? 1 : 0);
    })
    .catch((error: unknown) => {
      console.error("release-gate-report: fatal error", error);
      process.exit(1);
    });
}
/* c8 ignore stop */
