/**
 * `capability.audit` tool handler — runs the quarantine pipeline
 * (`../quarantine/pipeline.ts`) against a raw candidate descriptor,
 * persists the result into the capability store (`../capability-store/
 * store.ts`), and returns the `AuditReport`. Consumed today as a plain
 * function (see `./tool-definitions.ts`'s own doc comment on why this
 * isn't yet wired to a real `tools/call` dispatcher).
 *
 * ADVERSARIAL-REVIEW FIX (LOW/MEDIUM, confirmed dead guard): this handler
 * used to compute `reaudit` informationally but call `runQuarantinePipeline`
 * WITHOUT threading the store's previous digest for the same capability
 * NAME — stage 3's unsigned-digest-swap guard (`../quarantine/stages/
 * verify-provenance.ts`) only ever fires when `previousDigest` is
 * supplied, so in production it NEVER ran; only a hand-built test calling
 * `runQuarantinePipeline` directly with a manually-injected
 * `previousDigest` ever exercised it. This handler now threads
 * `deps.store.findLatestByName(name)?.report.digest` into the pipeline
 * call itself, so a real digest change for an already-known capability
 * name genuinely goes through stage 3's tamper check on every real
 * `capability.audit` invocation — a content update with no accompanying
 * valid signature is rejected exactly as roadmap/12's own "unsigned digest
 * change post-pin" seeded threat requires, not merely reported after the
 * fact via `reaudit`. (`reaudit`/`checkReauditRequired` remains as
 * additional informational context distinguishing "digest changed" from
 * "permission footprint changed" for a human reviewer — it does not gate
 * anything on its own.)
 *
 * **interface-ledger Gap 5, resolution (2026-08-01).** This handler used
 * to write the verdict into the capability store and NOWHERE else, which
 * meant a REJECTED capability audit produced zero journal entries
 * anywhere: the store artifact is rewritable, and the only journal entry
 * capability quarantine ever produced was the `approval_token_mint` a
 * human `trust approve` mints — which never happens for a rejection. The
 * verdict is now journaled as an `adjudication_decision` (the closed-at-13
 * reuse precedent phase 14 already set) BEFORE `store.save`, and a failed
 * append aborts the audit. See `../capability-store/audit-journal.ts`.
 */
import {
  CapabilityAuditJournalUnavailableError,
  buildCapabilityAuditVerdictRecord,
  journalCapabilityAuditVerdict,
  type CapabilityAuditJournalSink,
} from "../capability-store/audit-journal.js";
import type { CapabilityStore } from "../capability-store/store.js";
import { checkReauditRequired, type ReauditDecision } from "../capability-store/reaudit.js";
import { computeCandidateDigest } from "../quarantine/digest.js";
import { runQuarantinePipeline, type QuarantinePipelineOptions } from "../quarantine/pipeline.js";
import { CandidateSourceSchema, type AuditReport } from "../quarantine/types.js";

export interface CapabilityAuditInput {
  readonly candidate: unknown;
}

export interface CapabilityAuditDeps {
  readonly store: CapabilityStore;
  readonly pipelineOptions?: QuarantinePipelineOptions;
  /**
   * Where the verdict is journaled. OPTIONAL on the type only so this bag
   * stays structurally compatible with the read-mostly store consumers
   * that share it — `runCapabilityAudit` REJECTS with
   * `CapabilityAuditJournalUnavailableError` when it is absent rather than
   * auditing unjournaled (interface-ledger Gap 5, fail closed).
   */
  readonly journal?: CapabilityAuditJournalSink;
}

export interface CapabilityAuditOutput {
  readonly report: AuditReport;
  readonly reaudit?: ReauditDecision;
}

export async function runCapabilityAudit(
  input: CapabilityAuditInput,
  deps: CapabilityAuditDeps,
): Promise<CapabilityAuditOutput> {
  // Refused before any work happens: an audit whose verdict cannot be
  // journaled is one nobody can later verify occurred, which is strictly
  // worse than no audit because it looks like one.
  if (deps.journal === undefined) {
    throw new CapabilityAuditJournalUnavailableError("capability.audit");
  }

  // Computed BEFORE saving this run's result — otherwise the store would
  // already reflect this very audit, making "changed since last audit"
  // trivially always false.
  const parsed = CandidateSourceSchema.safeParse(input.candidate);
  const previous = parsed.success ? deps.store.findLatestByName(parsed.data.name) : undefined;
  const reaudit = parsed.success
    ? checkReauditRequired(
        deps.store,
        parsed.data.name,
        computeCandidateDigest(parsed.data),
        parsed.data.permissionFootprint,
      )
    : undefined;

  const pipelineOptions: QuarantinePipelineOptions = {
    ...(deps.pipelineOptions ?? {}),
    ...(previous !== undefined ? { previousDigest: previous.report.digest } : {}),
  };

  const { report, manifestEntry } = runQuarantinePipeline(input.candidate, pipelineOptions);

  // JOURNAL FIRST, then persist. A rejection here propagates and nothing
  // is written to the store, so the two records can never disagree about
  // whether an audit happened — and in particular the store can never
  // hold a verdict the tamper-evident journal has no entry for.
  await journalCapabilityAuditVerdict(
    deps.journal,
    buildCapabilityAuditVerdictRecord(report, reaudit),
  );
  deps.store.save(report, manifestEntry);

  return reaudit !== undefined ? { report, reaudit } : { report };
}
