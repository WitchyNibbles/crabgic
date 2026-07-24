import { randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, EvidenceRecordSchema, type EvidenceRecord } from "@eo/contracts";
import type { JournalStore } from "@eo/journal";
import type { GateContext, GateVerdict } from "./types.js";
import type { GateRiskTag } from "./risk-tags.js";

/**
 * `emitEvidence` — the one place this package turns a `GateVerdict` into a
 * journaled `EvidenceRecord`, per roadmap/14 §In scope: "Every firing ...
 * emits one `EvidenceRecord` (command, exit status, env/toolchain
 * fingerprint, timestamp, artifact digests, exact object ID) ... journaled
 * as a `JournalEntryType.evidence_pointer` entry." Called exactly once per
 * gate firing by `./registry.ts`'s `fireByTag`/`fireAll` — individual gate
 * modules never journal their own `EvidenceRecord` directly, so there is
 * exactly one emission code path for every registrant (this phase's own or
 * an external one, work item 6's registry-extensibility guarantee).
 */
export async function emitEvidence(
  journal: JournalStore,
  context: GateContext,
  gateTag: GateRiskTag,
  verdict: GateVerdict,
): Promise<EvidenceRecord> {
  const capturedAt = (context.now?.() ?? new Date()).toISOString();
  const record: EvidenceRecord = EvidenceRecordSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    changeSetId: context.changeSetId,
    ...(context.requirementId !== undefined ? { requirementId: context.requirementId } : {}),
    ...(context.workUnitId !== undefined ? { workUnitId: context.workUnitId } : {}),
    command: verdict.command,
    exitStatus: verdict.exitStatus,
    toolchainFingerprint: verdict.toolchainFingerprint,
    capturedAt,
    artifactDigests: verdict.artifactDigests,
    objectId: context.objectId,
    gateTag,
  });

  await journal.appendEntry({
    type: "evidence_pointer",
    changeSetId: context.changeSetId,
    ...(context.workUnitId !== undefined ? { workUnitId: context.workUnitId } : {}),
    payload: record,
  });

  return record;
}

/**
 * Every `evidence_pointer` entry whose payload's `requirementId` matches
 * `requirementId` — the reverse half of "`Requirement` → `EvidenceRecord` →
 * exact object ID resolves in both directions" (roadmap/14 §Exit criteria).
 * `queryEntries`'s own filter (`@eo/journal`) supports `type`/`runId`/
 * `changeSetId`/`workUnitId` but not an arbitrary payload field, so this
 * scans the (already type-narrowed) `evidence_pointer` stream client-side —
 * the same pattern `@eo/scheduler`'s `attempt-policy.ts` already uses for
 * its own payload-level `adjudication_decision` scans.
 */
export async function findEvidenceForRequirement(
  journal: JournalStore,
  requirementId: string,
): Promise<readonly EvidenceRecord[]> {
  const results: EvidenceRecord[] = [];
  for await (const entry of journal.queryEntries({ type: "evidence_pointer" })) {
    if (entry.type !== "evidence_pointer") continue;
    if (entry.payload.requirementId === requirementId) {
      results.push(entry.payload);
    }
  }
  return results;
}
