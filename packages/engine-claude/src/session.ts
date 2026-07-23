/**
 * `SessionRef` construction + transcript-path helpers (roadmap/06-claude-
 * engine-adapter.md work items 1/5; README design decision 2). A
 * `SessionRef`'s `sessionId` is the SDK's own pre-assignable session UUID
 * (`Options.sessionId`, sdk.d.ts 0.3.210) — the adapter always generates
 * and journals this id BEFORE the engine subprocess exists (README decision
 * 2), never lets the engine choose it. `projectDirectory` is always the
 * SAME value as `worktreePath` (07's layout: one worktree per worker, no
 * separate "project directory" concept above the worktree in this phase's
 * scope) — see `@eo/engine-core`'s `SessionRef` doc comment: "scoped to a
 * project directory and its worktrees."
 */
import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { IdSchema } from "@eo/contracts";
import type { SessionRef } from "@eo/engine-core";
import { mungeProjectDirectory } from "./hooks.js";

/**
 * Thrown by `createSessionRef` when a caller-supplied `sessionId` is not a
 * valid UUID (per `@eo/contracts`' own `IdSchema` — reused here rather than
 * a bespoke regex, per this repo's "reuse, never redefine" convention).
 * Supervisor's `WorkerRecordSchema` types `sessionId` as a UUID
 * (`packages/supervisor`'s own registry schema); this validation keeps
 * this package's own id generation consistent with that downstream
 * expectation instead of relying on `crypto.randomUUID()`'s own output
 * shape by convention alone.
 */
export class InvalidSessionIdError extends Error {
  constructor(readonly sessionId: string) {
    super(`session id is not a valid UUID: ${JSON.stringify(sessionId)}`);
    this.name = "InvalidSessionIdError";
  }
}

/** Input to `createSessionRef`. */
export interface CreateSessionRefInput {
  /** Absolute path to the supervisor-provisioned worktree this session is scoped to (07's layout). */
  readonly worktreePath: string;
  /** The `CLAUDE_CONFIG_DIR` this session's transcript/credentials are isolated under. */
  readonly configDir: string;
  /**
   * Pre-assigned session id. Omit to generate a fresh UUID (the ordinary
   * first-spawn path, README decision 2); supplied explicitly for a
   * `resume`/`fork` continuation of an existing id.
   */
  readonly sessionId?: string;
}

/**
 * Builds a `SessionRef` — `projectDirectory` always equals `worktreePath`
 * (this phase's scope: one worktree per worker, no separate project-
 * directory concept above it). Generates a fresh UUID via
 * `crypto.randomUUID()` when `sessionId` is omitted; either way, the
 * resulting id is validated against `@eo/contracts`' `IdSchema` before this
 * function returns — a malformed caller-supplied id is a fail-fast, never a
 * silently-accepted one.
 *
 * @throws {InvalidSessionIdError} if a caller-supplied `sessionId` is not a
 *   valid UUID.
 */
export function createSessionRef(input: CreateSessionRefInput): SessionRef {
  const sessionId = input.sessionId ?? randomUUID();
  if (!IdSchema.safeParse(sessionId).success) {
    throw new InvalidSessionIdError(sessionId);
  }
  return {
    sessionId,
    projectDirectory: input.worktreePath,
    worktreePath: input.worktreePath,
    configDir: input.configDir,
  };
}

/**
 * The transcript path for `sessionRef` — `<configDir>/projects/<munged-
 * cwd>/<sessionId>.jsonl` (docs/engine-baseline.md §7's confirmed munged-
 * cwd scheme), reusing W3's exported `mungeProjectDirectory` (`./hooks.js`)
 * rather than re-deriving the munging rule a second time. `hooks.ts`'s own
 * `createSessionEndEvidenceHook` computes this same path inline (it cannot
 * import from this file without a cycle risk given its own construction
 * order); this function is the public, reusable form of that same
 * computation for any other caller (tests, future CLI surfaces) that needs
 * the transcript path without constructing a `SessionEnd` hook.
 */
export function transcriptPathForSession(sessionRef: SessionRef): string {
  return posix.join(
    sessionRef.configDir,
    "projects",
    mungeProjectDirectory(sessionRef.projectDirectory),
    `${sessionRef.sessionId}.jsonl`,
  );
}
