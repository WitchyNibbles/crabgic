/**
 * The `Detector` shape every per-ecosystem detector in this directory
 * implements — roadmap/12-stack-detection-quarantine.md work item 1:
 * "Detector framework (pure per-ecosystem detectors) + evidence/confidence
 * model + contradiction reporting, populating `StackEvidence`." Every
 * detector is a PURE function over an already-walked file list plus a
 * bounded text-read primitive — no detector ever calls `node:child_process`
 * or re-walks the filesystem itself (see `../fs/safe-walk.ts`,
 * `../spawn-surface-scan.test.ts`).
 */
import type { StackEvidenceFinding } from "@eo/contracts";
import type { WalkedFile } from "../fs/safe-walk.js";

export interface DetectionContext {
  /** Every file under the walked root (see `../fs/safe-walk.ts`'s safety guarantees) — computed once, shared by every detector. */
  readonly files: readonly WalkedFile[];
  /** Bounded text read by repo-relative path; `undefined` for missing/oversized/unreadable — never throws. */
  readonly readFile: (relativePath: string) => string | undefined;
}

export interface Detector {
  /** A short, stable identifier for this detector (used only for diagnostics/tests, never surfaced in `StackEvidence` itself). */
  readonly id: string;
  /** Returns zero or more findings; a detector that finds nothing returns `[]`, never throws. */
  detect(ctx: DetectionContext): StackEvidenceFinding[];
}

/** Builds a `DetectionContext` from an already-computed file list and a repo-relative reader. */
export function buildDetectionContext(
  files: readonly WalkedFile[],
  readFile: (relativePath: string) => string | undefined,
): DetectionContext {
  return { files, readFile };
}

/** Finds every walked file whose relative path matches `predicate` — a small shared helper every detector uses instead of re-filtering `ctx.files` ad hoc. */
export function findFiles(
  ctx: DetectionContext,
  predicate: (relativePath: string) => boolean,
): readonly WalkedFile[] {
  return ctx.files.filter((f) => predicate(f.relativePath));
}
