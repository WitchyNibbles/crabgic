/**
 * Control clone — roadmap/07-git-control-repo-worktrees.md work item 5:
 * "`git clone --no-local` per project into `$XDG_CACHE_HOME/engineering-
 * orchestrator/<project-hash>/git-control/`; never shared object
 * alternates; fetch strategy for target-ref updates."
 *
 * `--no-local` forces the non-optimized clone transport even for a local
 * filesystem source path — the control clone gets its own real object
 * store, never a hardlinked/shared one, and (since `--shared`/`--reference`
 * are never passed) no `objects/info/alternates` file is ever created.
 *
 * `onStep` is an optional, test-only injection seam (default no-op) called
 * at defined internal checkpoints — the same technique this package's
 * crash tests use to interrupt a multi-step operation deterministically
 * (see `./control-clone.crash.test.ts`), without production code needing
 * to import any kill-harness machinery itself.
 */

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  CONTROL_CONTEXT_ENV,
  OPTION_TERMINATOR,
  assertSafeRefPositional,
} from "./git-arg-guard.js";
import { neutralizeHooksPath } from "./repo-validation.js";
import type { GitPlumbing } from "./plumbing.js";

export interface ControlCloneOptions {
  readonly sourceRepoPath: string;
  readonly controlDir: string;
  readonly onStep?: (step: string) => void;
}

export interface ControlCloneResult {
  readonly controlDir: string;
  /** `true` if this call performed a fresh clone; `false` if `controlDir` already held a `.git` and was reused as-is. */
  readonly created: boolean;
}

/** Idempotent: if `controlDir/.git` already exists, returns immediately with `created: false` — never re-clones over an existing control repo. */
export async function ensureControlClone(
  plumbing: GitPlumbing,
  options: ControlCloneOptions,
): Promise<ControlCloneResult> {
  const { sourceRepoPath, controlDir, onStep } = options;

  if (existsSync(`${controlDir}/.git`)) {
    return { controlDir, created: false };
  }

  onStep?.("before-clone");
  await mkdir(dirname(controlDir), { recursive: true });
  // CRITICAL 1 fix: `sourceRepoPath`/`controlDir` are caller-influenced
  // positionals — `OPTION_TERMINATOR` (confirmed accepted by `clone`
  // against real git 2.43.0) stops a flag-shaped value (e.g.
  // `--upload-pack=...`) from being parsed as an option.
  // MAJOR 2 fix: `CONTROL_CONTEXT_ENV` neutralizes ambient global/system
  // git config (hooks/filters) for the clone's own initial checkout —
  // repo-local `neutralizeHooksPath` below only takes effect AFTER this
  // clone has already run, so it alone cannot protect the clone itself.
  await plumbing.run(["clone", "--no-local", OPTION_TERMINATOR, sourceRepoPath, controlDir], {
    env: CONTROL_CONTEXT_ENV,
  });

  onStep?.("after-clone-before-hooks-neutralize");
  await neutralizeHooksPath(plumbing, controlDir);

  onStep?.("after-hooks-neutralize-before-done");
  return { controlDir, created: true };
}

/** `git fetch origin <ref>` against an already-cloned control dir, returning the fetched object id (`FETCH_HEAD`). */
export async function fetchRefresh(
  plumbing: GitPlumbing,
  controlDir: string,
  ref: string,
): Promise<string> {
  // CRITICAL 1 fix: `ref` is a caller-influenced positional. Proven RCE
  // against real git 2.43.0 (`./argument-injection.regression.test.ts`): a
  // ref of `--upload-pack=<cmd>` makes git invoke `<cmd>` as the transport
  // helper on this local-filesystem fetch. Both defense axes: reject a
  // flag-shaped ref up front (never even reaches git), AND
  // `OPTION_TERMINATOR` as belt-and-suspenders (confirmed accepted by
  // `fetch` against real git 2.43.0).
  assertSafeRefPositional("ref", ref);
  // MAJOR 2 fix: every operation against the control clone runs with
  // ambient global/system git config neutralized.
  await plumbing.run(["fetch", OPTION_TERMINATOR, "origin", ref], {
    cwd: controlDir,
    env: CONTROL_CONTEXT_ENV,
  });
  const result = await plumbing.run(["rev-parse", "FETCH_HEAD"], {
    cwd: controlDir,
    env: CONTROL_CONTEXT_ENV,
  });
  return result.stdout.trim();
}
