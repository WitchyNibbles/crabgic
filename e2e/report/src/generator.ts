import { isNegativeEvidence, type EvidenceRecord } from "@crabgic/contracts";
import type { JournalEntry, JournalEntryFilter } from "@crabgic/journal";
import {
  RELEASE_GATE_SCHEMA_VERSION,
  type ReleaseGateChecklistItemResult,
  type ReleaseGateEvidenceLink,
  type ReleaseGateReport,
  type ReleaseGateScoringMode,
  type ReleaseGateVerdict,
} from "./schema.js";
import { RELEASE_GATE_CHECKLIST, type ReleaseGateChecklistItemSpec } from "./checklist.js";

/**
 * The minimal read surface this generator needs from a `JournalStore`
 * (roadmap/23 §Interfaces consumed, row "04": "Journal chain + `EvidenceRecord`
 * query surface ... Release-gate report generator reads EvidenceRecords
 * directly from the journal"). Deliberately narrower than the full
 * `JournalStore` interface so tests can hand this a bare
 * `{ queryEntries }` stub without constructing a real store when they don't
 * need one — see `generator.test.ts`'s unit tests (the property/idempotency
 * tests use a real `createJournalStore` via `./test-support/test-journal.js`
 * for full-fidelity coverage of the real journal read path).
 */
export interface EvidenceJournalReader {
  queryEntries(filter?: JournalEntryFilter): AsyncIterable<JournalEntry>;
}

/**
 * Every `EvidenceRecord` journaled for exactly `releaseCandidateObjectId`,
 * in ascending journal `seq` order (the order they were originally
 * appended) — this fixed order, derived purely from the journal's own
 * content, is what makes `generateReleaseGateReport`'s `linkedEvidence`
 * arrays IDEMPOTENT across repeated runs against the same journal segment
 * (roadmap/23 §Test plan, "Property": "report is idempotent — re-running
 * against the same journal segment yields the same verdict").
 */
async function evidenceForCandidate(
  journal: EvidenceJournalReader,
  releaseCandidateObjectId: string,
): Promise<readonly { readonly seq: number; readonly record: EvidenceRecord }[]> {
  const matches: { readonly seq: number; readonly record: EvidenceRecord }[] = [];
  for await (const entry of journal.queryEntries({ type: "evidence_pointer" })) {
    if (entry.type !== "evidence_pointer") continue;
    if (entry.payload.objectId !== releaseCandidateObjectId) continue;
    matches.push({ seq: entry.seq, record: entry.payload });
  }
  return [...matches].sort((a, b) => a.seq - b.seq);
}

function toEvidenceLink(record: EvidenceRecord): ReleaseGateEvidenceLink {
  return {
    evidenceRecordId: record.id,
    objectId: record.objectId,
    artifactDigests: record.artifactDigests,
    ...(record.gateTag !== undefined ? { gateTag: record.gateTag } : {}),
    exitStatus: record.exitStatus,
  };
}

/**
 * Scores one checklist item against the pre-fetched, release-candidate-
 * scoped evidence set. Exported directly so unit tests can exercise the
 * checklist-item <-> EvidenceRecord matching/scoring logic in isolation
 * from journal I/O (roadmap/23 §Test plan, "Unit": "checklist-item <->
 * EvidenceRecord linkage; missing-evidence detection returns FAIL, not
 * PASS-by-default").
 *
 * FAIL-FIRST / DEFAULT-DENY (the core invariant): this function can NEVER
 * return `"PASS"` when `matched` is empty, in either `scoringMode`. Zero
 * matched evidence is either `"FAIL"` (`"final"` mode — a required item
 * with no evidence blocks the release) or `"EVIDENCE-PENDING"` (`"interim"`
 * mode — no run attempted yet, distinct from a genuine negative result).
 * A `"PASS"` requires >=1 matched record AND that no matched record is a
 * genuine negative run per `isNegativeEvidence` (`@crabgic/contracts`) — a
 * single negative record among the
 * matches forces `"FAIL"` regardless of how many green records also exist,
 * since all matches share the one exact, immutable release-candidate
 * object ID (a genuine re-run after a fix necessarily lands on a NEW
 * object ID, which becomes a NEW report's `releaseCandidateObjectId` — see
 * this module's file-level doc comment).
 */
export function scoreChecklistItem(
  item: ReleaseGateChecklistItemSpec,
  matchedEvidence: readonly EvidenceRecord[],
  scoringMode: ReleaseGateScoringMode,
): ReleaseGateChecklistItemResult {
  if (matchedEvidence.length === 0) {
    const verdict: ReleaseGateVerdict = scoringMode === "final" ? "FAIL" : "EVIDENCE-PENDING";
    return {
      id: item.id,
      description: item.description,
      required: item.required,
      verdict,
      linkedEvidence: [],
      reason:
        verdict === "FAIL"
          ? "zero EvidenceRecord matched this item's required gate tags for the release " +
            "candidate object ID — a required item defaults to FAIL at final release time " +
            "(fail-first: never PASS-by-default)."
          : "zero EvidenceRecord matched this item's required gate tags for the release " +
            "candidate object ID yet — no run attempted (EVIDENCE-PENDING, interim scoring " +
            "only; never PASS-by-default).",
    };
  }

  const negative = matchedEvidence.filter(isNegativeEvidence);
  const verdict: ReleaseGateVerdict = negative.length > 0 ? "FAIL" : "PASS";
  return {
    id: item.id,
    description: item.description,
    required: item.required,
    verdict,
    linkedEvidence: matchedEvidence.map(toEvidenceLink),
    reason:
      verdict === "FAIL"
        ? `${String(negative.length)} of ${String(matchedEvidence.length)} linked ` +
          "EvidenceRecord(s) report a genuine negative run (a failed gate verdict, or a " +
          "nonzero exitStatus where no verdict was recorded)."
        : `${String(matchedEvidence.length)} linked EvidenceRecord(s), none a negative run, ` +
          "for the release candidate object ID.",
  };
}

/**
 * `FAIL` if any item is `FAIL`; else `EVIDENCE-PENDING` if any item is
 * `EVIDENCE-PENDING`; else `PASS`. `PASS` is therefore reachable ONLY when
 * every single item independently scored `PASS` — the same fail-first
 * invariant `scoreChecklistItem` enforces per-item, lifted to the whole
 * report. In `"final"` scoring mode no item can ever be `EVIDENCE-PENDING`
 * (see `scoreChecklistItem`), so a `"final"`-mode report's `overallVerdict`
 * is always exactly `PASS` or `FAIL` — never `EVIDENCE-PENDING` — which is
 * this module's concrete rendering of the roadmap's "the final release
 * gate treats pending-required as not-yet-PASS" instruction.
 */
export function computeOverallVerdict(
  items: readonly ReleaseGateChecklistItemResult[],
): ReleaseGateVerdict {
  if (items.some((i) => i.verdict === "FAIL")) return "FAIL";
  if (items.some((i) => i.verdict === "EVIDENCE-PENDING")) return "EVIDENCE-PENDING";
  return "PASS";
}

export interface GenerateReleaseGateReportInput {
  readonly journal: EvidenceJournalReader;
  readonly releaseCandidateObjectId: string;
  readonly scoringMode: ReleaseGateScoringMode;
  /** Defaults to `RELEASE_GATE_CHECKLIST` (the 15 roadmap/23 Exit-criteria items). Overridable so tests can exercise the generator against a small synthetic checklist. */
  readonly checklist?: readonly ReleaseGateChecklistItemSpec[];
  /** Injectable clock for deterministic tests — see `schema.ts`'s doc comment on why `generatedAt` is excluded from the idempotency property (it is the one field this report allows to vary run-to-run). */
  readonly now?: () => string;
}

function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * Reads every `evidence_pointer` `JournalEntry` scoped to
 * `releaseCandidateObjectId`, matches each checklist item against them by
 * `gateTag` (see `checklist.ts`'s doc comment), scores every item via
 * `scoreChecklistItem`, and rolls the whole report up via
 * `computeOverallVerdict`.
 */
export async function generateReleaseGateReport(
  input: GenerateReleaseGateReportInput,
): Promise<ReleaseGateReport> {
  const checklist = input.checklist ?? RELEASE_GATE_CHECKLIST;
  const now = input.now ?? defaultNow;
  const evidence = await evidenceForCandidate(input.journal, input.releaseCandidateObjectId);

  const items = checklist.map((item) => {
    const matched = evidence
      .filter(
        ({ record }) =>
          record.gateTag !== undefined && item.requiredGateTags.includes(record.gateTag),
      )
      .map(({ record }) => record);
    return scoreChecklistItem(item, matched, input.scoringMode);
  });

  return {
    schemaVersion: RELEASE_GATE_SCHEMA_VERSION,
    releaseCandidateObjectId: input.releaseCandidateObjectId,
    generatedAt: now(),
    scoringMode: input.scoringMode,
    items,
    overallVerdict: computeOverallVerdict(items),
  };
}
