import {
  CURRENT_SCHEMA_VERSION,
  classifyGrantedCommand,
  type AcceptanceEvaluationRecord,
  type CommandInvocationTally,
  type GrantableCommandPrefix,
} from "@crabgic/contracts";
import type { EngineEvent } from "@crabgic/engine-core";

/**
 * The observer half of owner ruling R5 — the thing that watches an attempt's
 * engine event stream and writes down what it actually RAN.
 *
 * WHY HERE. `consumeEvents` is the only code in this repository that sees every
 * `EngineEvent` a worker produces, and `toolUse` events were being iterated past
 * and dropped. That stream is the sole INDEPENDENT account of an attempt: every
 * other artifact a run keeps about what a worker did is authored by the worker.
 * `docs/evidence/phase-25/published-unverified.md` is what happens without it —
 * a run published on `{"summary":"test"}` from a worker whose twelve `Bash` calls
 * had all failed to start.
 *
 * WHAT IT REFUSES TO DO, and each of these is load-bearing rather than an
 * omission:
 *
 *  - **It never keeps the command string.** `toolInput.command` is
 *    worker-authored, the record is journaled, and the journal is permanent.
 *    Every invocation is folded onto the closed `GrantableCommandPrefix`
 *    vocabulary at the moment it is seen, so what survives is an enum member and
 *    two integers. Same rule `journalSealRefusal` states for its own payload.
 *  - **It never parses tool output.** The first draft of R5 keyed on the string
 *    `Failed to create bridge sockets`, which is one host's phrasing of one
 *    version's failure — a detector that goes quietly wrong on the next engine
 *    release, in the direction of reporting success. `is_error` is a typed flag
 *    the engine sets, and an absent flag counts as not-clean.
 *  - **It never treats an ungranted command as evidence.** A `Bash` call
 *    matching no grant is counted nowhere. It cannot have been permitted by the
 *    compiled profile, so crediting it would be crediting something that did not
 *    happen.
 */

/** Mutable per-attempt tallies, keyed by grant. Not exported — `snapshot` is the only way out. */
type Tallies = Map<GrantableCommandPrefix, { invocations: number; cleanExits: number }>;

/**
 * The tool a granted command runs under.
 *
 * A literal rather than a config member: `MANDATORY_BASH_ALLOWLIST` compiles
 * every `GrantableCommandPrefix` into a `Bash(… :*)` permission rule, so `Bash`
 * is the only tool through which a grant can be exercised at all. Counting any
 * other tool's `command` input would credit a grant for work the profile never
 * permitted under it.
 */
const GRANTED_COMMAND_TOOL = "Bash";

export interface AcceptanceObserver {
  /** Folds one event in. Ignores everything that is not a completed `Bash` tool_use/tool_result pair. */
  readonly observe: (event: EngineEvent) => void;
  /** The tallies so far, in `GRANTABLE_COMMAND_PREFIXES` order, with never-invoked grants absent. */
  readonly snapshot: () => readonly CommandInvocationTally[];
}

export function createAcceptanceObserver(): AcceptanceObserver {
  const tallies: Tallies = new Map();

  function observe(event: EngineEvent): void {
    if (event.type !== "toolUse") return;
    if (event.toolName !== GRANTED_COMMAND_TOOL) return;
    /**
     * ONLY THE RESULT HALF COUNTS. The normalizer yields a `toolUse` event twice
     * for one call — once when the model requests it (no `toolResult`), once when
     * the result arrives. Counting both would double every invocation, and
     * counting the request half alone would count calls that never ran at all,
     * which is precisely the population this gate exists to detect.
     */
    if (event.toolResult === undefined) return;
    const command: unknown = event.toolInput["command"];
    if (typeof command !== "string") return;
    const prefix = classifyGrantedCommand(command);
    if (prefix === undefined) return;

    const current = tallies.get(prefix) ?? { invocations: 0, cleanExits: 0 };
    /**
     * `=== false` and not `!== true`. An absent flag means the engine did not
     * say, and "did not say" must not read as "succeeded" — that is the same
     * fail-closed direction `findLatestCriteriaSeal`'s `undefined` takes.
     */
    tallies.set(prefix, {
      invocations: current.invocations + 1,
      cleanExits: current.cleanExits + (event.toolResultIsError === false ? 1 : 0),
    });
  }

  function snapshot(): readonly CommandInvocationTally[] {
    return [...tallies.entries()]
      .map(([prefix, counts]) => ({
        prefix,
        invocations: counts.invocations,
        cleanExits: counts.cleanExits,
      }))
      .sort((a, b) => (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0));
  }

  return { observe, snapshot };
}

/**
 * Assembles the journalable record, or `undefined` when there is no change set
 * to attribute it to.
 *
 * `changeSetId` comes from the attempt's own `CriteriaApprovalSeal` rather than
 * from a field a caller supplies. That is deliberate and it is stronger: the
 * seal is journaled at approval, so the observation is attributed to exactly the
 * change set whose sealed bar this attempt was judged under, and no caller can
 * point one run's verification at another run's gate. It also costs nothing —
 * `AttemptCriteriaSeal` is already a required parameter on both public entry
 * points, so no call site changes.
 *
 * An attempt with NO approval seal produces no record. That is fail-closed, not
 * a gap: an unsealed attempt cannot report `succeeded` at all (the seal check
 * refuses it), and a gate that saw no record refuses to publish.
 */
export function buildAcceptanceEvaluation(params: {
  readonly changeSetId: string | undefined;
  readonly workUnitId: string;
  readonly sessionId: string;
  readonly requirementIds: readonly string[];
  readonly invocations: readonly CommandInvocationTally[];
  readonly observedAt: string;
}): AcceptanceEvaluationRecord | undefined {
  if (params.changeSetId === undefined) return undefined;
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    changeSetId: params.changeSetId,
    workUnitId: params.workUnitId,
    sessionId: params.sessionId,
    requirementIds: [...params.requirementIds],
    invocations: [...params.invocations],
    observedAt: params.observedAt,
  };
}
