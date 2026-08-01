/**
 * Capability-quarantine journaling — the vocabulary behind
 * `docs/interface-ledger.md` Gap 5's **resolution** (2026-08-01).
 *
 * ## What was broken
 *
 * Gap 5 closed `JournalEntryType` at 13 members and left one tension
 * explicitly open: a capability-audit pass/fail verdict has no clean
 * dedicated member. In practice that tension was not merely a naming
 * question — it meant **a rejected capability audit produced zero journal
 * entries anywhere**. `../mcp/capability-audit-handler.ts` persisted only
 * into the capability store; `./store.ts`'s `updateDecision` OVERWROTE
 * `report.json` in place with no history; and the `pending -> approved`
 * flip in `../mcp/capability-approve-handler.ts` was unjournaled too. The
 * single central record was the `approval_token_mint` written when a human
 * ran `trust approve` — which by construction never happens for a
 * REJECTED candidate. The store artifact is a rewritable file; the journal
 * is the hash-chained, tamper-evident one (04). So the security-relevant
 * half of the trail lived only in the rewritable half.
 *
 * ## The ruling
 *
 * The union stays **closed at 13**. Capability-quarantine verdicts and
 * decision transitions journal as `adjudication_decision` entries — the
 * exact precedent phase 14 already set and the ledger already blessed for
 * its own gate evidence (`@crabgic/gates`'s `coverage/ratchet-store.ts` and
 * `flake/quarantine-registry.ts`, and before them `@crabgic/scheduler`'s
 * `parking.ts`/`shadow-run.ts`/`attempt-policy.ts`). A dedicated 14th
 * member would carry the same information at the cost of a coordinated
 * cross-phase resolution round; reuse carries it today.
 *
 * ## The shape
 *
 * `payload.decision` is a namespaced discriminator under the
 * `capability_audit:` prefix; `payload.rationale` is the JSON-encoded
 * record. That is phase 14's shape verbatim (discriminator in `decision`,
 * structured detail JSON-encoded in `rationale`), with the prefix added so
 * every capability-quarantine entry is recognisable by one string test
 * regardless of how many record kinds this module grows.
 *
 * Note the deliberate boundary with Gap 20 ("what a schema can carry, a
 * schema should carry"): Gap 20 governs fields on payloads this repo owns
 * and may extend — e.g. `criteriaSeal` was added as a TYPED optional field
 * on `AdjudicationDecisionPayloadSchema` rather than stuffed into
 * `rationale`. Adding capability-audit-shaped typed fields to that shared,
 * `.strict()` payload would push phase-12 vocabulary into a contract every
 * other adjudication writer shares. The JSON-in-rationale convention is
 * what phase 14 established for exactly this case — a phase-local record
 * riding a generic member — and this module keeps it schema-validated on
 * both write and read so it is a contract in practice, not a convention.
 *
 * The store artifact remains the DETAILED record (full stage details,
 * findings, sandbox result); the journal carries the tamper-evident
 * verdict and every subsequent transition.
 */
import { z } from "zod";
import { CapabilityDecisionSchema, type JournalEntryType } from "@crabgic/contracts";
import { computeCapabilityStoreKey } from "./key.js";
import type { ReauditDecision } from "./reaudit.js";
import {
  CapabilityKindSchema,
  PIPELINE_STAGES,
  SCAN_SEVERITIES,
  auditReachedManifestEntry,
  type AuditReport,
} from "../quarantine/types.js";

/** Every capability-quarantine `adjudication_decision` discriminator starts with this. */
export const CAPABILITY_AUDIT_DECISION_PREFIX = "capability_audit:";

/** `payload.decision` for one completed run of the 6-stage quarantine pipeline. */
export const CAPABILITY_AUDIT_VERDICT_DECISION = `${CAPABILITY_AUDIT_DECISION_PREFIX}verdict`;

/** `payload.decision` for a `CapabilityDecision` transition against an already-stored entry. */
export const CAPABILITY_DECISION_TRANSITION_DECISION = `${CAPABILITY_AUDIT_DECISION_PREFIX}decision_transition`;

/**
 * The one-method sink this package writes capability-quarantine entries
 * through. Deliberately narrower than `JournalStore` — the same
 * minimal-sink convention `@crabgic/contracts`'s `ApprovalTokenMintSink`
 * already uses, so a caller can satisfy it with a real `JournalStore`, and
 * a test can satisfy it without one. The `type` is pinned by `Extract` so
 * this seam can never widen into a second, unreviewed journal writer.
 */
export interface CapabilityAuditJournalEntryInput {
  readonly type: Extract<JournalEntryType, "adjudication_decision">;
  readonly payload: { readonly decision: string; readonly rationale: string };
}

export interface CapabilityAuditJournalSink {
  appendEntry(input: CapabilityAuditJournalEntryInput): Promise<unknown>;
}

/**
 * Thrown when a capability-quarantine operation that MUST leave a durable
 * verdict is asked to run without a journal sink. Fail closed: an audit
 * nobody can later verify happened is worse than no audit, because it
 * looks like one.
 */
export class CapabilityAuditJournalUnavailableError extends Error {
  constructor(operation: string) {
    super(
      `${operation}: refusing to proceed without a journal sink — capability-quarantine verdicts and decision transitions must be journaled (interface-ledger Gap 5)`,
    );
    this.name = "CapabilityAuditJournalUnavailableError";
  }
}

const PipelineStageSchema = z.enum(PIPELINE_STAGES);
const ScanSeveritySchema = z.enum(SCAN_SEVERITIES);

const StageOutcomeSchema = z.object({ stage: PipelineStageSchema, passed: z.boolean() }).strict();

/**
 * One pipeline run's verdict. Everything a reader needs to answer "what
 * was decided about this capability, and on what basis" without holding
 * the (rewritable, and for a pre-fetch failure never-written) store
 * artifact: which stages ran and which failed, how many scan findings at
 * which severities, the pinned digest, and why a re-audit was or was not
 * required.
 *
 * Finding DETAILS are intentionally not journaled — a scanner detail line
 * can quote matched source text, and the secret scanner's whole job is
 * matching secrets. Count plus severity set is the security-relevant
 * summary; `./store.ts`'s 0600 artifact holds the rest.
 */
export const CapabilityAuditVerdictRecordSchema = z
  .object({
    storeKey: z.string().min(1),
    candidateName: z.string().min(1),
    kind: CapabilityKindSchema,
    digest: z.string().min(1),
    decision: CapabilityDecisionSchema,
    stages: z.array(StageOutcomeSchema).readonly(),
    reachedManifestEntry: z.boolean(),
    scanFindingCount: z.number().int().nonnegative(),
    /** The DISTINCT severities observed, ordered least-to-most severe per `SCAN_SEVERITIES`. */
    scanFindingSeverities: z.array(ScanSeveritySchema).readonly(),
    reauditRequired: z.boolean().optional(),
    reauditReason: z.string().min(1).optional(),
    auditedAt: z.string().min(1),
  })
  .strict();
export type CapabilityAuditVerdictRecord = z.infer<typeof CapabilityAuditVerdictRecordSchema>;

/** One `CapabilityDecision` transition against an already-stored entry (`pending -> approved`, `approved -> rejected`, ...). */
export const CapabilityDecisionTransitionRecordSchema = z
  .object({
    storeKey: z.string().min(1),
    candidateName: z.string().min(1),
    digest: z.string().min(1),
    from: CapabilityDecisionSchema,
    to: CapabilityDecisionSchema,
    recordedAt: z.string().min(1),
  })
  .strict();
export type CapabilityDecisionTransitionRecord = z.infer<
  typeof CapabilityDecisionTransitionRecordSchema
>;

/** Distinct severities present in `report.scanFindings`, ordered least-to-most severe (deterministic, so two identical audits journal byte-identical records). */
function distinctSeverities(report: AuditReport): readonly (typeof SCAN_SEVERITIES)[number][] {
  const present = new Set(report.scanFindings.map((f) => f.severity));
  return SCAN_SEVERITIES.filter((s) => present.has(s));
}

/**
 * Builds the verdict record for `report`. `storeKey` is derived here from
 * the same pure `computeCapabilityStoreKey` the store itself uses, so the
 * record can be journaled BEFORE `store.save` and still point at the entry
 * that save will create.
 */
export function buildCapabilityAuditVerdictRecord(
  report: AuditReport,
  reaudit?: ReauditDecision,
): CapabilityAuditVerdictRecord {
  return {
    storeKey: computeCapabilityStoreKey(report.digest, report.permissionFootprint),
    candidateName: report.candidateName,
    kind: report.kind,
    digest: report.digest,
    decision: report.decision,
    stages: report.stages.map((s) => ({ stage: s.stage, passed: s.passed })),
    reachedManifestEntry: auditReachedManifestEntry(report),
    scanFindingCount: report.scanFindings.length,
    scanFindingSeverities: distinctSeverities(report),
    ...(reaudit !== undefined
      ? { reauditRequired: reaudit.requiresReaudit, reauditReason: reaudit.reason }
      : {}),
    auditedAt: report.auditedAt,
  };
}

/** Appends one verdict. Rejects if the sink rejects — every caller treats that as fatal (fail closed). */
export async function journalCapabilityAuditVerdict(
  journal: CapabilityAuditJournalSink,
  record: CapabilityAuditVerdictRecord,
): Promise<void> {
  await journal.appendEntry({
    type: "adjudication_decision",
    payload: {
      decision: CAPABILITY_AUDIT_VERDICT_DECISION,
      rationale: JSON.stringify(CapabilityAuditVerdictRecordSchema.parse(record)),
    },
  });
}

/** Appends one decision transition. Rejects if the sink rejects — the caller must then NOT rewrite the artifact. */
export async function journalCapabilityDecisionTransition(
  journal: CapabilityAuditJournalSink,
  record: CapabilityDecisionTransitionRecord,
): Promise<void> {
  await journal.appendEntry({
    type: "adjudication_decision",
    payload: {
      decision: CAPABILITY_DECISION_TRANSITION_DECISION,
      rationale: JSON.stringify(CapabilityDecisionTransitionRecordSchema.parse(record)),
    },
  });
}

/** Guarded parse — never throws on malformed or foreign journal content (the same "never trust file content" precedent `@crabgic/gates`'s ratchet store follows). */
function parseRecord<T>(rationale: string, schema: z.ZodType<T>): T | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rationale);
  } catch {
    return undefined;
  }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

export function parseCapabilityAuditVerdict(
  rationale: string,
): CapabilityAuditVerdictRecord | undefined {
  return parseRecord(rationale, CapabilityAuditVerdictRecordSchema);
}

export function parseCapabilityDecisionTransition(
  rationale: string,
): CapabilityDecisionTransitionRecord | undefined {
  return parseRecord(rationale, CapabilityDecisionTransitionRecordSchema);
}

/** The read side of the sink — anything that can iterate `adjudication_decision` entries. */
export interface CapabilityAuditJournalReader {
  queryEntries(filter?: { readonly type?: JournalEntryType }): AsyncIterable<{
    readonly type: JournalEntryType;
    readonly payload: unknown;
  }>;
}

function asAdjudicationPayload(
  payload: unknown,
): { readonly decision: string; readonly rationale: string } | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const { decision, rationale } = payload as Record<string, unknown>;
  return typeof decision === "string" && typeof rationale === "string"
    ? { decision, rationale }
    : undefined;
}

/**
 * Every capability-quarantine verdict in the journal, in append order,
 * optionally narrowed to one capability name. This is what makes the
 * journal an actual audit trail rather than write-only storage: a rejected
 * candidate never reaches the manifest, so the journal is the ONLY place a
 * human or a later gate can enumerate what was refused and why.
 */
export async function readCapabilityAuditVerdicts(
  journal: CapabilityAuditJournalReader,
  candidateName?: string,
): Promise<readonly CapabilityAuditVerdictRecord[]> {
  const verdicts: CapabilityAuditVerdictRecord[] = [];
  for await (const entry of journal.queryEntries({ type: "adjudication_decision" })) {
    if (entry.type !== "adjudication_decision") continue;
    const payload = asAdjudicationPayload(entry.payload);
    if (payload?.decision !== CAPABILITY_AUDIT_VERDICT_DECISION) continue;
    const record = parseCapabilityAuditVerdict(payload.rationale);
    if (record === undefined) continue;
    if (candidateName !== undefined && record.candidateName !== candidateName) continue;
    verdicts.push(record);
  }
  return verdicts;
}

/** Every decision transition in the journal, in append order, optionally narrowed to one store key. */
export async function readCapabilityDecisionTransitions(
  journal: CapabilityAuditJournalReader,
  storeKey?: string,
): Promise<readonly CapabilityDecisionTransitionRecord[]> {
  const transitions: CapabilityDecisionTransitionRecord[] = [];
  for await (const entry of journal.queryEntries({ type: "adjudication_decision" })) {
    if (entry.type !== "adjudication_decision") continue;
    const payload = asAdjudicationPayload(entry.payload);
    if (payload?.decision !== CAPABILITY_DECISION_TRANSITION_DECISION) continue;
    const record = parseCapabilityDecisionTransition(payload.rationale);
    if (record === undefined) continue;
    if (storeKey !== undefined && record.storeKey !== storeKey) continue;
    transitions.push(record);
  }
  return transitions;
}
