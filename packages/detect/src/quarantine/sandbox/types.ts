/**
 * Stage 5 (sandbox_test) types — roadmap/12 §In scope, "Quarantine
 * pipeline" bullet: "test without credentials or egress, inside an
 * `@anthropic-ai/sandbox-runtime` jail (... the standalone package for
 * wrapping non-Claude processes in the engine's own sandbox jail)."
 *
 * **Deviation (flagged in the phase-12 final report):** `@anthropic-ai/
 * sandbox-runtime` is NOT present in this repo's root lockfile — adding it
 * would be a new external dependency this task is barred from introducing
 * unilaterally. roadmap/12 §Risks explicitly anticipates exactly this:
 * "Treat the exact stage-5 harness as a phase-12-local spike before
 * trusting it as a security boundary" — this module IS that spike. It
 * defines the `SandboxRunner` port real code would call, and
 * `./fake-sandbox-runner.ts` is a pure, in-process policy evaluator
 * standing in for it: never spawns a real process/container, never
 * provides an actual OS-level security boundary. A real implementation
 * swaps in behind this same interface once the dependency lands — no
 * caller-visible interface change required.
 */

import { z } from "zod";

export const DECLARED_OPERATION_TYPES = ["network", "read", "write"] as const;
export type DeclaredOperationType = (typeof DECLARED_OPERATION_TYPES)[number];

/** One operation a candidate's own self-test declares it will attempt — the sandbox harness's input, never inferred by executing anything. */
export const DeclaredOperationSchema = z
  .object({
    type: z.enum(DECLARED_OPERATION_TYPES),
    /** A domain (for `network`) or an absolute/`~`-relative path (for `read`/`write`). */
    target: z.string().trim().min(1),
  })
  .strict();
export type DeclaredOperation = z.infer<typeof DeclaredOperationSchema>;

/** The fixed, restrictive policy every stage-5 run uses — roadmap/12's own wording: "without credentials or egress" (`allowedDomains: []`), "denyRead" for sensitive paths. */
export interface SandboxPolicy {
  readonly allowedDomains: readonly string[];
  readonly denyReadPaths: readonly string[];
}

export const DEFAULT_SANDBOX_POLICY: SandboxPolicy = {
  allowedDomains: [],
  denyReadPaths: ["~/.ssh", "~/.aws", "~/.config/gcloud", "~/.netrc"],
};

export interface SandboxTestResult {
  /**
   * `true` iff the harness ran to completion AND no declared operation was
   * denied by the policy — `false` whenever `deniedOperations` is
   * non-empty (adversarial-review fix: this used to be hardcoded `true`
   * regardless of denials, making stage 5 a structurally vacuous,
   * fail-open gate — a candidate declaring network egress or a `~/.ssh`
   * read reached stage 6 identically to a genuinely benign one). A real
   * OS-level implementation could ALSO set this `false` on a pure
   * harness-level failure (e.g. the jail itself failed to start), a
   * distinct failure mode this in-process evaluator cannot itself hit.
   */
  readonly passed: boolean;
  /** Every declared operation the policy denied, verbatim (`"<type>:<target>"`) — recorded for the audit report regardless of `passed`. */
  readonly deniedOperations: readonly string[];
  readonly detail: string;
}

export interface SandboxRunner {
  run(operations: readonly DeclaredOperation[], policy: SandboxPolicy): SandboxTestResult;
}
