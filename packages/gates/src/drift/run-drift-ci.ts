import {
  compareDriftFixture,
  type DriftFixtureSnapshot,
  type DriftProposal,
} from "./drift-proposal.js";
import { DriftDebounceTracker, type DriftDebounceState } from "./debounce.js";

/**
 * Drift-CI job runner — roadmap/21 work item 5 / §Exit criteria: "Drift-CI
 * job run against an intentionally bumped fixture produces exactly one
 * `DriftProposal` artifact and a red CI check, with zero pinned-fixture/
 * config changes applied by the job itself."
 *
 * ZERO PINNED-FIXTURE CHANGES, BY CONSTRUCTION: this function's only two
 * side-effecting capabilities are the two functions in `RunDriftCiDeps`
 * below — `saveDebounceState` (this job's OWN debounce counters) and
 * `writeProposals` (the `DriftProposal[]` artifact for human review).
 * There is no third capability, no generic file-write, and no import of
 * anything that could touch a pinned cassette/config file — the type
 * signature itself is the proof; `./run-drift-ci.no-pinned-write.test.ts`
 * additionally greps this module's own source for any write-shaped call
 * outside those two deps, as a second, independent check.
 */
export interface RunDriftCiDeps {
  readonly loadDebounceState: () => Promise<DriftDebounceState>;
  readonly saveDebounceState: (state: DriftDebounceState) => Promise<void>;
  readonly writeProposals: (proposals: readonly DriftProposal[]) => Promise<void>;
  readonly now?: () => Date;
}

export interface RunDriftCiInput {
  readonly snapshots: readonly DriftFixtureSnapshot[];
  readonly debounceThreshold?: number;
}

export interface RunDriftCiResult {
  readonly proposals: readonly DriftProposal[];
  /** `true` iff at least one `DriftProposal` was emitted this run — the CI job's own exit-code decision (red check) is `redCheck ? 1 : 0`. */
  readonly redCheck: boolean;
}

function snapshotKey(snapshot: DriftFixtureSnapshot): string {
  return `${snapshot.connector}:${snapshot.pinnedVersion}`;
}

export async function runDriftCi(
  input: RunDriftCiInput,
  deps: RunDriftCiDeps,
): Promise<RunDriftCiResult> {
  const state = await deps.loadDebounceState();
  const tracker = new DriftDebounceTracker(input.debounceThreshold, state);

  const proposals: DriftProposal[] = [];
  for (const snapshot of input.snapshots) {
    const comparison = compareDriftFixture(snapshot, deps.now);
    const outcome = tracker.recordRun(snapshotKey(snapshot), comparison.drifted);
    if (outcome.shouldEmit && comparison.proposal !== undefined) {
      proposals.push(comparison.proposal);
    }
  }

  await deps.saveDebounceState(tracker.dump());
  await deps.writeProposals(proposals);

  return { proposals, redCheck: proposals.length > 0 };
}
