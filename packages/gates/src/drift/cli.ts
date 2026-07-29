import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CRABGIC_DIR_NAME, readXdgEnvFromProcess, resolveXdgStateHome } from "@crabgic/journal";
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
 * Default paths deliberately live OUTSIDE the repo tree, never inside
 * `packages/gates/`, so a local/CI invocation with no explicit `--state-dir`
 * never creates an untracked file inside the repo working tree that would need
 * a `.gitignore` entry (out of this phase's package-boundary to add).
 *
 * This comment used to claim the scheduled job "points both paths at
 * `runner.temp` explicitly". It does not, and never did:
 * `.github/workflows/drift-ci.yml` runs `node packages/gates/dist/drift/cli.js`
 * with NO arguments and hard-codes the DEFAULT paths in its cache and
 * artifact-upload steps. The claim read as a mitigation — "CI is not exposed to
 * whatever the default is" — and there was none, so the defect below applied to
 * the scheduled job as much as to a developer's laptop. The workflow's three
 * paths track the default and must move with it.
 *
 * ROAST ROUND 30: "outside the repo tree" used to mean `os.tmpdir()`, at two
 * fixed, predictable names — the same defect class the doctor's sweep cursor
 * had, found by sweeping the codebase for it. Executed through THIS exported
 * entry point with no options, so the defaults were what was under test:
 *
 *   ln -s $ATTACKER_DIR $TMPDIR/eo-drift-ci
 *     -> `debounce-state.json` AND `drift-proposals.json` both landed in
 *        $ATTACKER_DIR, because `mkdir(..., {recursive:true})` succeeds on an
 *        existing symlink-to-directory and the write follows it.
 *   ln -s ~/victim.json $TMPDIR/eo-drift-ci/debounce-state.json
 *     -> the victim's contents were rewritten with the debounce state.
 *
 * The XDG state root is not world-writable, so an attacker cannot plant either
 * component. `O_NOFOLLOW` on the file itself is not redundant with that: the
 * caller may pass any path it likes, and a home directory can be group-writable
 * or on a shared filesystem.
 */
const DRIFT_STATE_SUBDIR = "drift-ci";

/**
 * Resolved PER CALL, not pinned at import.
 *
 * A module-level constant derived from the environment cannot be corrected by
 * the environment (a test that sets `XDG_STATE_HOME` after import gets the old
 * value), and one derived from `readXdgEnvFromProcess` would THROW at import
 * time wherever `HOME` is unset — breaking every consumer of this package,
 * including the ones that pass explicit paths and never touch the default.
 */
function driftStateDir(): string {
  return join(resolveXdgStateHome(readXdgEnvFromProcess()), CRABGIC_DIR_NAME, DRIFT_STATE_SUBDIR);
}

export function defaultDebounceStatePath(): string {
  return join(driftStateDir(), "debounce-state.json");
}

export function defaultProposalsOutputPath(): string {
  return join(driftStateDir(), "drift-proposals.json");
}

/**
 * `O_NOFOLLOW` refuses a symlink at open time; `O_NONBLOCK` is what stops a
 * FIFO blocking in `open(2)` — this CLI has no timeout of its own, so a
 * writerless FIFO at the state path hung the whole drift job. Anything that is
 * not a regular file is treated as "no state", which is what an unreadable
 * state file already meant.
 */
async function loadDebounceStateFromDisk(path: string): Promise<DriftDebounceState> {
  try {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      if (!(await handle.stat()).isFile()) return {};
      return JSON.parse(await handle.readFile("utf-8")) as DriftDebounceState;
    } finally {
      await handle.close();
    }
  } catch {
    return {};
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // No `O_TRUNC` in the flags: truncation is a write, and it must not happen to
  // anything the `isFile` check below would go on to reject.
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    0o600,
  );
  try {
    if (!(await handle.stat()).isFile()) {
      throw new Error(`drift-ci: refusing to write to ${path} — it is not a regular file`);
    }
    await handle.truncate(0);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf-8");
  } finally {
    await handle.close();
  }
}

export interface DriftCiCliOptions {
  readonly debounceStatePath?: string;
  readonly proposalsOutputPath?: string;
  readonly debounceThreshold?: number;
}

export async function runDriftCiCli(
  options: DriftCiCliOptions = {},
): Promise<{ redCheck: boolean }> {
  const debounceStatePath = options.debounceStatePath ?? defaultDebounceStatePath();
  const proposalsOutputPath = options.proposalsOutputPath ?? defaultProposalsOutputPath();

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
