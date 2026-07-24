import { join } from "node:path";
import { resolveStateRoot, type XdgEnv } from "@eo/journal";

/**
 * On-disk layout for this phase's proposal store — roadmap/22-learning-
 * system.md §In scope, "Storage policy": "Personal/transient lessons live
 * under `$XDG_STATE_HOME/engineering-orchestrator/<project-hash>/learning/`
 * (04's pinned state root), outside the repo." This module nests `learning/`
 * under 04's `resolveStateRoot` (interface-ledger Gap 14's sibling
 * convention) rather than re-deriving the XDG root itself.
 *
 * SEPARATION OF DUTIES, STRUCTURALLY (roadmap/22 §In scope, "Separation of
 * duties" — the keystone invariant this whole package protects): three
 * disjoint subdirectories, not one shared tree:
 *
 *   - `registry/`   — the canonical `LearningProposal` pipeline-state
 *                      records (`../proposal-store/registry.ts`). Every
 *                      pipeline stage from `observation` through
 *                      `independent_review` writes here.
 *   - `grader/dev/`  — dev-set eval case fixtures. Writable while the case
 *                      set is being assembled; never referenced by the
 *                      proposer-facing API at all (no proposer-facing
 *                      constructor even accepts this path — a type-level
 *                      absence, not just a runtime check).
 *   - `grader/held-out/` — held-out eval case fixtures. Same as `dev/`,
 *                      PLUS an explicit seal step
 *                      (`../store/case-fixture-store.ts`'s `sealDirectory`)
 *                      that `chmod`s this directory (and every file in it)
 *                      to a read-only mode once the held-out set is
 *                      finalized — an OS-enforced boundary a same-uid
 *                      "proposer" process cannot write past no matter what
 *                      code path it runs, proven directly (not merely
 *                      asserted) by `../store/grader-isolation.test.ts`.
 *
 * `registryDir` is exposed to BOTH proposer- and grader-facing code (the
 * pipeline-state record itself is not the secret; the grading MATERIAL is)
 * — `graderDir`/`heldOutDir` are exposed only to grader-facing construction
 * paths (`../store/grader-store.ts`), never to
 * `../proposal-store/proposer-store.ts`.
 */
export const LEARNING_STATE_SUBDIR = "learning";
export const LEARNING_REGISTRY_SUBDIR = "registry";
export const LEARNING_GRADER_SUBDIR = "grader";
export const LEARNING_GRADER_DEV_SUBDIR = "dev";
export const LEARNING_GRADER_HELD_OUT_SUBDIR = "held-out";

/** Directory mode for every writable directory this package creates. Sealed held-out directories are re-chmod'd to `LEARNING_SEALED_DIR_MODE` instead (see `../store/case-fixture-store.ts`). */
export const LEARNING_DIR_MODE = 0o700;
/** Read+execute, no write — applied to a held-out directory (and its files, via `LEARNING_SEALED_FILE_MODE`) once sealed. Blocks writes from ANY same-uid process, including this package's own proposer-facing code, at the OS level. */
export const LEARNING_SEALED_DIR_MODE = 0o500;
export const LEARNING_SEALED_FILE_MODE = 0o400;

export function resolveLearningDir(env: XdgEnv, projectHash: string): string {
  return join(resolveStateRoot(env, projectHash), LEARNING_STATE_SUBDIR);
}

export function resolveRegistryDir(env: XdgEnv, projectHash: string): string {
  return join(resolveLearningDir(env, projectHash), LEARNING_REGISTRY_SUBDIR);
}

export function resolveGraderDir(env: XdgEnv, projectHash: string): string {
  return join(resolveLearningDir(env, projectHash), LEARNING_GRADER_SUBDIR);
}

export function resolveDevCasesDir(env: XdgEnv, projectHash: string): string {
  return join(resolveGraderDir(env, projectHash), LEARNING_GRADER_DEV_SUBDIR);
}

export function resolveHeldOutCasesDir(env: XdgEnv, projectHash: string): string {
  return join(resolveGraderDir(env, projectHash), LEARNING_GRADER_HELD_OUT_SUBDIR);
}
