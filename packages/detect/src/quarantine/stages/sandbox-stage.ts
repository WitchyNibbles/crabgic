/**
 * Stage 5 (sandbox_test) — roadmap/12 §In scope, "Quarantine pipeline"
 * bullet: "(5) test without credentials or egress, inside a sandbox
 * jail." Runs the candidate's own declared `selfTestPlan`
 * (`../types.ts`) through a `SandboxRunner` (`../sandbox/types.ts`) under
 * the fixed, restrictive `DEFAULT_SANDBOX_POLICY`, and propagates the
 * runner's own policy verdict straight through as this stage's
 * `StageResult.passed` — a candidate whose self-test declares network
 * egress or a sensitive read (`~/.ssh`, etc.) FAILS this stage and never
 * reaches stage 6 (see `../sandbox/fake-sandbox-runner.ts`'s own doc
 * comment: adversarial-review fix, this used to be a fail-open no-op that
 * only recorded the denial without rejecting). The real OS-jail runtime
 * (`@anthropic-ai/sandbox-runtime`) stays a documented carry-forward — but
 * even this in-process stand-in genuinely gates on the policy verdict now,
 * not a hardcoded pass.
 */
import {
  DEFAULT_SANDBOX_POLICY,
  type SandboxRunner,
  type SandboxTestResult,
} from "../sandbox/types.js";
import type { CandidateSource, StageResult } from "../types.js";

export interface SandboxStageOutcome {
  readonly result: StageResult;
  readonly sandboxResult: SandboxTestResult;
}

export function runSandboxStage(
  candidate: CandidateSource,
  runner: SandboxRunner,
): SandboxStageOutcome {
  const sandboxResult = runner.run(candidate.selfTestPlan ?? [], DEFAULT_SANDBOX_POLICY);
  return {
    sandboxResult,
    result: { stage: "sandbox_test", passed: sandboxResult.passed, detail: sandboxResult.detail },
  };
}
