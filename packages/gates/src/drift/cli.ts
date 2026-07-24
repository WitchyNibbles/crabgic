import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runDriftCi, type RunDriftCiDeps } from "./run-drift-ci.js";
import { buildPinnedFixtureSnapshots } from "./pinned-fixtures.js";
import type { DriftDebounceState } from "./debounce.js";

/**
 * `.github/workflows/drift-ci.yml`'s actual entrypoint — the ONLY module in
 * this package that touches real disk I/O for the drift job (kept
 * deliberately separate from `./run-drift-ci.ts`, which
 * `./no-pinned-write.test.ts` proves is write-primitive-free). Reads/writes
 * ONLY its own debounce-state file and its own proposals-output file —
 * never any pinned cassette/config path anywhere else in the repo.
 *
 * Default paths deliberately live OUTSIDE the repo tree (`node:os`'s
 * `tmpdir()`), never inside `packages/gates/`, so a local/CI invocation
 * with no explicit `--state-dir` never creates an untracked file inside
 * the repo working tree that would need a `.gitignore` entry (out of this
 * phase's package-boundary to add). The real scheduled CI job
 * (`.github/workflows/drift-ci.yml`) points both paths at `runner.temp`
 * explicitly and uploads the proposals file as a workflow artifact instead
 * of persisting it in-repo.
 */
export const DEFAULT_DEBOUNCE_STATE_PATH = join(tmpdir(), "eo-drift-ci", "debounce-state.json");
export const DEFAULT_PROPOSALS_OUTPUT_PATH = join(tmpdir(), "eo-drift-ci", "drift-proposals.json");

async function loadDebounceStateFromDisk(path: string): Promise<DriftDebounceState> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as DriftDebounceState;
  } catch {
    return {};
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export interface DriftCiCliOptions {
  readonly debounceStatePath?: string;
  readonly proposalsOutputPath?: string;
  readonly debounceThreshold?: number;
}

export async function runDriftCiCli(
  options: DriftCiCliOptions = {},
): Promise<{ redCheck: boolean }> {
  const debounceStatePath = options.debounceStatePath ?? DEFAULT_DEBOUNCE_STATE_PATH;
  const proposalsOutputPath = options.proposalsOutputPath ?? DEFAULT_PROPOSALS_OUTPUT_PATH;

  const deps: RunDriftCiDeps = {
    loadDebounceState: () => loadDebounceStateFromDisk(debounceStatePath),
    saveDebounceState: (state) => writeJsonFile(debounceStatePath, state),
    writeProposals: (proposals) => writeJsonFile(proposalsOutputPath, proposals),
  };

  const snapshots = buildPinnedFixtureSnapshots({
    ...(process.env["JIRA_OBSERVED_VERSION"] !== undefined
      ? { jira: { version: process.env["JIRA_OBSERVED_VERSION"] } }
      : {}),
    ...(process.env["GRAFANA_OBSERVED_VERSION"] !== undefined
      ? { grafana: { version: process.env["GRAFANA_OBSERVED_VERSION"] } }
      : {}),
  });

  const result = await runDriftCi(
    {
      snapshots,
      ...(options.debounceThreshold !== undefined
        ? { debounceThreshold: options.debounceThreshold }
        : {}),
    },
    deps,
  );

  if (result.proposals.length > 0) {
    console.error(
      `drift-ci: ${String(result.proposals.length)} DriftProposal(s) written to ${proposalsOutputPath} — human review required.`,
    );
  }

  return { redCheck: result.redCheck };
}

/* c8 ignore start -- process.exit / import.meta CLI entrypoint glue, not unit-testable logic. */
const isMainModule =
  process.argv[1]?.endsWith("cli.js") === true || process.argv[1]?.endsWith("cli.ts") === true;
if (isMainModule) {
  runDriftCiCli()
    .then((result) => {
      process.exit(result.redCheck ? 1 : 0);
    })
    .catch((error: unknown) => {
      console.error("drift-ci: fatal error", error);
      process.exit(1);
    });
}
/* c8 ignore stop */
