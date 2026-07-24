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
 */
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
}

export interface CapabilityAuditOutput {
  readonly report: AuditReport;
  readonly reaudit?: ReauditDecision;
}

export function runCapabilityAudit(
  input: CapabilityAuditInput,
  deps: CapabilityAuditDeps,
): CapabilityAuditOutput {
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
  deps.store.save(report, manifestEntry);

  return reaudit !== undefined ? { report, reaudit } : { report };
}
