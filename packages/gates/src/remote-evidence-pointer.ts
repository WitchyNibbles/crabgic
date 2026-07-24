import { randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, EvidenceRecordSchema, type EvidenceRecord } from "@eo/contracts";
import type { JournalStore } from "@eo/journal";

/**
 * Evidence-pointer population — roadmap/21-connector-evidence-integration.md
 * work item 1: "write `evidence_pointer` `JournalEntryType` entries linking
 * `Requirement.id`↔`RemoteResource.id` as 18/20 resolve tracking issues/
 * dashboards; bidirectional lookup in `packages/gates`."
 *
 * DEVIATION (documented, disclosed — see docs/evidence/phase-21/README.md):
 * roadmap/21's own prose describes this pointer's payload as
 * `{requirementId, remoteResourceId, relation}`. `@eo/contracts`'s
 * `RemoteResourceSchema` doc comment forward-references exactly that shape.
 * But `@eo/journal` (phase 04, already-built, out of this phase's package
 * boundary) locks the `evidence_pointer` `JournalEntryType`'s payload to
 * `EvidenceRecordSchema` verbatim ("payload validates as `EvidenceRecord`
 * ... per work item 1's explicit instruction" — `journal-payloads.ts`), a
 * `.strict()` zod object with no `remoteResourceId`/`relation` fields. This
 * phase cannot edit `packages/journal` or `packages/contracts` (explicit
 * package-boundary constraint), so it cannot add those fields.
 *
 * Resolution: every remote-resource evidence pointer IS a fully valid
 * `EvidenceRecord`, using fields that already exist on that schema:
 *  - `requirementId` — the real field, real semantic match.
 *  - `objectId` — the real exact object id under test at binding time
 *    (preserves this field's documented meaning; never repurposed).
 *  - `command` — carries `remote-resource-pointer:<relation>:<remoteResourceId>`,
 *    a documented, parseable convention (`REMOTE_RESOURCE_POINTER_PREFIX`
 *    below) — the only way to durably encode `remoteResourceId`+`relation`
 *    without a schema change.
 *  - `artifactDigests` — carries `remote-revision:<revision>` when a
 *    confirmed remote revision is already known at pointer-write time (work
 *    item 2's binding), one entry per known revision.
 *  - `gateTag` — fixed to `"remote_verification"` (this phase's gate, work
 *    item 3), consistent with `EvidenceRecord.gateTag`'s documented
 *    "risk-tag/gate identifier" meaning.
 *
 * This convention is internal to this package: roadmap/21 §Interfaces
 * produced states these pointers are "consumed internally by this phase's
 * traceability view and verification gate; no other phase reads them
 * directly" — so no cross-phase contract is broken by this encoding choice.
 * A future coordinated schema extension (adding real `remoteResourceId`/
 * `relation` fields to `EvidenceRecord`) is a documented carry-forward, not
 * done here.
 */

export const REMOTE_RESOURCE_RELATIONS = ["tracking-issue", "dashboard", "alert"] as const;
export type RemoteResourceRelation = (typeof REMOTE_RESOURCE_RELATIONS)[number];

export function isRemoteResourceRelation(value: string): value is RemoteResourceRelation {
  return (REMOTE_RESOURCE_RELATIONS as readonly string[]).includes(value);
}

const REMOTE_RESOURCE_POINTER_PREFIX = "remote-resource-pointer:";
const REMOTE_REVISION_PREFIX = "remote-revision:";
const REMOTE_VERIFICATION_GATE_TAG = "remote_verification";
const POINTER_TOOLCHAIN_FINGERPRINT = "remote-evidence-pointer@1";

function encodePointerCommand(relation: RemoteResourceRelation, remoteResourceId: string): string {
  return `${REMOTE_RESOURCE_POINTER_PREFIX}${relation}:${remoteResourceId}`;
}

/** Parses `command` back into `{relation, remoteResourceId}`; `undefined` if `command` isn't a pointer-encoded entry (e.g. an ordinary gate-firing `EvidenceRecord`). */
function decodePointerCommand(
  command: string,
): { readonly relation: RemoteResourceRelation; readonly remoteResourceId: string } | undefined {
  if (!command.startsWith(REMOTE_RESOURCE_POINTER_PREFIX)) return undefined;
  const rest = command.slice(REMOTE_RESOURCE_POINTER_PREFIX.length);
  const separatorIndex = rest.indexOf(":");
  if (separatorIndex < 0) return undefined;
  const relationRaw = rest.slice(0, separatorIndex);
  const remoteResourceId = rest.slice(separatorIndex + 1);
  if (!isRemoteResourceRelation(relationRaw) || remoteResourceId.length === 0) return undefined;
  return { relation: relationRaw, remoteResourceId };
}

function decodeConfirmedRevision(artifactDigests: readonly string[]): string | undefined {
  const found = artifactDigests.find((d) => d.startsWith(REMOTE_REVISION_PREFIX));
  return found === undefined ? undefined : found.slice(REMOTE_REVISION_PREFIX.length);
}

export interface RemoteEvidencePointerInput {
  readonly requirementId: string;
  readonly remoteResourceId: string;
  readonly relation: RemoteResourceRelation;
  readonly changeSetId: string;
  /** The exact object id under test at binding time (e.g. the owning WorkUnit's candidate object id). */
  readonly objectId: string;
  /** The confirmed remote revision, if already read-back-verified at pointer-write time (work item 2). */
  readonly confirmedRevision?: string;
  readonly now?: () => Date;
}

/** A resolved remote-resource evidence pointer, decoded back from the journal. */
export interface RemoteEvidencePointer {
  readonly requirementId: string;
  readonly remoteResourceId: string;
  readonly relation: RemoteResourceRelation;
  readonly objectId: string;
  readonly confirmedRevision?: string;
  readonly evidenceRecordId: string;
}

/** Writes one `evidence_pointer` `JournalEntryType` entry linking `requirementId`↔`remoteResourceId` (see file-level doc comment for the encoding convention this uses). */
export async function recordEvidencePointer(
  journal: JournalStore,
  input: RemoteEvidencePointerInput,
): Promise<EvidenceRecord> {
  const capturedAt = (input.now?.() ?? new Date()).toISOString();
  const record: EvidenceRecord = EvidenceRecordSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    changeSetId: input.changeSetId,
    requirementId: input.requirementId,
    command: encodePointerCommand(input.relation, input.remoteResourceId),
    exitStatus: 0,
    toolchainFingerprint: POINTER_TOOLCHAIN_FINGERPRINT,
    capturedAt,
    artifactDigests:
      input.confirmedRevision !== undefined
        ? [`${REMOTE_REVISION_PREFIX}${input.confirmedRevision}`]
        : [],
    objectId: input.objectId,
    gateTag: REMOTE_VERIFICATION_GATE_TAG,
  });

  await journal.appendEntry({
    type: "evidence_pointer",
    changeSetId: input.changeSetId,
    payload: record,
  });

  return record;
}

function toPointer(entry: EvidenceRecord): RemoteEvidencePointer | undefined {
  if (entry.requirementId === undefined) return undefined;
  // MINOR-2 fix (adversarial-validation round): the `gateTag` belt this
  // module's own file-level doc comment advertises must actually be
  // enforced here — an adjacent writer whose `command` happens to collide
  // with this module's pointer-encoding prefix, but under a DIFFERENT
  // `gateTag`, is never misread as a real connector pointer.
  if (entry.gateTag !== REMOTE_VERIFICATION_GATE_TAG) return undefined;
  const decoded = decodePointerCommand(entry.command);
  if (decoded === undefined) return undefined;
  const confirmedRevision = decodeConfirmedRevision(entry.artifactDigests);
  return {
    requirementId: entry.requirementId,
    remoteResourceId: decoded.remoteResourceId,
    relation: decoded.relation,
    objectId: entry.objectId,
    ...(confirmedRevision !== undefined ? { confirmedRevision } : {}),
    evidenceRecordId: entry.id,
  };
}

/**
 * FORWARD direction: every remote-resource pointer recorded for
 * `requirementId`. A lookup against an empty journal — or a requirement
 * with no pointers at all — returns `[]`, never throws (roadmap/21 work
 * item 1's failing-first requirement).
 */
export async function findRemoteResourcePointersForRequirement(
  journal: JournalStore,
  requirementId: string,
): Promise<readonly RemoteEvidencePointer[]> {
  const results: RemoteEvidencePointer[] = [];
  for await (const entry of journal.queryEntries({ type: "evidence_pointer" })) {
    if (entry.type !== "evidence_pointer") continue;
    if (entry.payload.requirementId !== requirementId) continue;
    const pointer = toPointer(entry.payload);
    if (pointer !== undefined) results.push(pointer);
  }
  return results;
}

/**
 * REVERSE direction: every requirement id pointing at `remoteResourceId`.
 * Also returns `[]`, never throws, against an empty journal or an
 * unpointed-to resource.
 */
export async function findRequirementsForRemoteResource(
  journal: JournalStore,
  remoteResourceId: string,
): Promise<readonly RemoteEvidencePointer[]> {
  const results: RemoteEvidencePointer[] = [];
  for await (const entry of journal.queryEntries({ type: "evidence_pointer" })) {
    if (entry.type !== "evidence_pointer") continue;
    const pointer = toPointer(entry.payload);
    if (pointer !== undefined && pointer.remoteResourceId === remoteResourceId) {
      results.push(pointer);
    }
  }
  return results;
}
