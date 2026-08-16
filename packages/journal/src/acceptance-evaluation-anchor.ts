import type { AcceptanceEvaluationRecord } from "@crabgic/contracts";
import type { JournalStore } from "./store/journal-store.js";

/**
 * The journal anchor for owner ruling R5's acceptance-evaluation records — what
 * an attempt actually RAN, written by the one component that observes it and
 * read back by the gate that refuses to publish without it.
 *
 * WHY THE JOURNAL AND NOT XDG STATE, which is where ruling R8's stage
 * completions went. Two properties decide it, and they point the same way:
 *
 *   - This is EVIDENCE ABOUT A RUN, and the run's other evidence — the seal, the
 *     attempt transitions, every gate's `EvidenceRecord` — is already here.
 *     Splitting one run's evidentiary trail across two stores would mean no
 *     single artifact answers "what happened to this run".
 *   - It must be TAMPER-EVIDENT. It is the input to a publish refusal, so it is
 *     the record most worth rewriting: an observation saying the tests ran turns
 *     a refusal into a publication. The journal is append-only and hash-chained;
 *     the XDG stores are plain files. R8's stage completions do not carry that
 *     requirement in the same way — the design gate they open is owner-anchored
 *     through `OwnerDesignVerdict`, which the CLI alone writes.
 *
 * WHY NOT A NEW ENTRY TYPE: `JournalEntryType` is closed at thirteen members
 * (`docs/interface-ledger.md` Gap 5, which says a fourteenth needs a fresh
 * coordinated round rather than a unilateral addition). Judging what an attempt
 * ran is an adjudication about that attempt, so it rides on
 * `adjudication_decision` as an optional typed payload member — the precedent
 * `journalCriteriaSeal` set, and the same one `journalSealRefusal` follows.
 *
 * WHY A DIRECT TYPED READ and not the structural DFS `packages/perf`'s anchor
 * uses: this module owns both ends of the write, so a typed field and a direct
 * read are simply correct. A generic object-graph search would be an
 * abstraction built for a caller that does not exist.
 */

/** The `decision` discriminator these entries carry, so a reader can find them without matching on shape. */
export const ACCEPTANCE_EVALUATION_DECISION = "acceptance_evaluation_observed";

/**
 * Records what one completed attempt ran.
 *
 * Called once per attempt that reaches a terminal result, whatever that result
 * was — including a FAILED one. A failed attempt's observations are still the
 * truth about what executed, and writing only the successful ones would make the
 * record's absence ambiguous between "nothing ran" and "the attempt failed".
 *
 * Appends. A repair attempt writes its own record beside the first rather than
 * replacing it, and `findAcceptanceEvaluations` returns them all: coverage is a
 * UNION over attempts, because a requirement verified on attempt one does not
 * become unverified because attempt two only rebuilt.
 *
 * `rationale` is derived here from the record's own counts and never from
 * worker-authored text. Everything a worker could influence has already been
 * folded onto the closed `GrantableCommandPrefix` vocabulary by the caller.
 */
export async function journalAcceptanceEvaluation(
  journal: JournalStore,
  record: AcceptanceEvaluationRecord,
  runId?: string,
): Promise<void> {
  const invoked = record.invocations.reduce((total, tally) => total + tally.invocations, 0);
  const clean = record.invocations.reduce((total, tally) => total + tally.cleanExits, 0);
  await journal.appendEntry({
    type: "adjudication_decision",
    changeSetId: record.changeSetId,
    ...(runId !== undefined ? { runId } : {}),
    workUnitId: record.workUnitId,
    payload: {
      decision: ACCEPTANCE_EVALUATION_DECISION,
      rationale:
        `observed ${String(invoked)} granted command invocation(s), ${String(clean)} clean, ` +
        `across ${String(record.invocations.length)} distinct grant(s)`,
      subjectId: record.workUnitId,
      acceptanceEvaluation: record,
    },
  });
}

/**
 * Every acceptance-evaluation record journaled for `changeSetId`, in append
 * order.
 *
 * ALL of them, deliberately — the opposite of `findLatestCriteriaSeal`'s
 * recency rule, and for a reason worth stating. A seal is a bar that can be
 * legitimately replaced, so only the newest one is in force. An observation is a
 * fact about something that already happened, and facts accumulate: three work
 * units and two repair attempts produce five records, and the gate's question is
 * about their union.
 *
 * The `changeSetId` filter is applied on the ENTRY envelope and re-checked on
 * the payload, because a record naming another change set inside an entry
 * addressed to this one would let one run's verification satisfy another's gate.
 *
 * An empty result is a legitimate answer meaning "nothing was observed", and
 * every caller must treat it as NOT verified rather than as nothing to check —
 * which is the direction `unevaluatedRequirements` already fails in.
 */
export async function findAcceptanceEvaluations(
  journal: JournalStore,
  changeSetId: string,
): Promise<readonly AcceptanceEvaluationRecord[]> {
  const found: AcceptanceEvaluationRecord[] = [];
  for await (const entry of journal.queryEntries({ type: "adjudication_decision", changeSetId })) {
    if (entry.type !== "adjudication_decision") continue;
    const record = entry.payload.acceptanceEvaluation;
    if (record === undefined || record.changeSetId !== changeSetId) continue;
    found.push(record);
  }
  return found;
}
