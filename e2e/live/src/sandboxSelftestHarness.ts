import {
  createRealProcessProbe,
  createSandboxSelftestCheck,
  type DoctorFinding,
  type ProcessProbeFn,
} from "crabgic";

/**
 * Hermeticity + sandbox self-test harness — roadmap/23-release-hardening.md
 * work item 7: "re-run 03/06's compiled-profile self-tests on a clean host
 * (build the harness; it can execute the offline/fake parts now, `@live`
 * parts are tagged `@live` for the live wave)."
 *
 * `sandbox.selftest` (`packages/cli/src/doctor/checks/sandbox-selftest.ts`,
 * re-exported from `crabgic`) needs only `bwrap` on the
 * host — no Claude Code engine, no auth, no network — so it is the
 * OFFLINE-runnable half of this pair and runs for real, right here, in the
 * default (non-`@live`) gate. `hermeticity.selftest`'s own real-probe arm
 * spawns the real `claude` binary and therefore needs auth/a subscription
 * turn; that arm is deliberately NOT re-implemented here — it is this
 * harness's `src/live/hermeticitySelftest.live.test.ts` counterpart,
 * `@live`-tagged for the later wave, per this work item's own instruction.
 */
export async function runSandboxSelftest(probe: ProcessProbeFn): Promise<DoctorFinding> {
  const check = createSandboxSelftestCheck({ probe });
  return check.run();
}

/** The real, host-spawning probe (`bwrap --version` presence + the actual confinement write-denial attempt) — safe to run unconditionally, matching `docs/engine-baseline.md`'s own recorded host facts (`bwrap` 0.9.0 present). */
export function realSandboxProbe(): ProcessProbeFn {
  return createRealProcessProbe();
}
