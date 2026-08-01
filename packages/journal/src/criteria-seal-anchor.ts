import type { CriteriaApprovalSeal } from "@crabgic/contracts";
import type { JournalStore } from "./store/journal-store.js";

/**
 * The journal anchor for roadmap/24's acceptance-criteria seal.
 *
 * WHY THE JOURNAL AND NOT THE RECORD: `@crabgic/contracts`' `verifyCriteriaSeal`
 * checks a requirement against a seal, but a seal read out of the same
 * mutable store as the record it describes proves nothing — that is the
 * MAJOR finding `../../perf/src/contract/hash-link.ts` records against its
 * own earlier self-checksum-only design. 04's journal is append-only and
 * hash-chained, so a value committed here at approval time cannot be
 * silently rewritten later without breaking the chain. Same reasoning,
 * same substrate, different subject.
 *
 * WHY NOT A NEW ENTRY TYPE: `JournalEntryType` is closed at 13 members
 * (`docs/interface-ledger.md` Gap 5, which explicitly says a 14th requires a
 * fresh coordinated round and not a unilateral addition — phases 12 and 14
 * made the same call for their own decisions). Approving a ChangeSet IS an
 * adjudication decision, so the seal rides on `adjudication_decision` as an
 * optional, typed payload member.
 *
 * WHY NOT THE STRUCTURAL DFS the perf anchor uses: that anchor searches
 * `remote_operation_record` blobs for an object with a matching `id`
 * precisely because it is reading back a record 11 committed for its own
 * unrelated reasons, in a shape 15 is not entitled to assume. Here the
 * write is deliberate and this module owns both ends, so a typed field and
 * a direct read are simply correct — a generic object-graph search would be
 * an unused abstraction built for a caller that does not exist.
 */

/**
 * Records the criteria seal for an approved ChangeSet.
 *
 * Called at the `awaiting_approval -> ready` transition, once per approval.
 * Re-approval after a material amendment appends a NEW seal rather than
 * editing the old one — the journal is append-only, and superseding by
 * recency is what `findLatestCriteriaSeal` reads.
 */
export async function journalCriteriaSeal(
  journal: JournalStore,
  seal: CriteriaApprovalSeal,
): Promise<void> {
  await journal.appendEntry({
    type: "adjudication_decision",
    changeSetId: seal.changeSetId,
    payload: {
      decision: "criteria_sealed",
      rationale: `sealed ${Object.keys(seal.criteriaHashes).length} requirement acceptance-criteria set(s) at approval`,
      subjectId: seal.changeSetId,
      criteriaSeal: seal,
    },
  });
}

/**
 * Reads back the LATEST seal recorded for `changeSetId`, or `undefined` if
 * this ChangeSet was never sealed.
 *
 * LATEST, deliberately — the opposite of the perf budget anchor's
 * first-writer-wins. A material amendment demotes a ChangeSet and it is
 * approved again against new criteria; first-writer-wins would brand that
 * legitimate re-approval as tamper forever, and would simultaneously let a
 * rollback to the superseded criteria verify clean. Recency is what makes
 * "the criteria in force are the criteria most recently approved" checkable.
 *
 * `undefined` is a FAIL-CLOSED input, never "unsealed means trust it" —
 * see `assertCriteriaSealIntact` in `@crabgic/contracts`.
 */
export async function findLatestCriteriaSeal(
  journal: JournalStore,
  changeSetId: string,
): Promise<CriteriaApprovalSeal | undefined> {
  let latest: CriteriaApprovalSeal | undefined;
  // Ascending append order (`queryEntries`' documented contract), so the
  // last match wins rather than the first.
  for await (const entry of journal.queryEntries({ type: "adjudication_decision", changeSetId })) {
    if (entry.type !== "adjudication_decision") continue;
    const seal = entry.payload.criteriaSeal;
    if (seal !== undefined && seal.changeSetId === changeSetId) latest = seal;
  }
  return latest;
}
