import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema } from "../shared/ids.js";

/**
 * `DocumentationRecord` — the documentation stage's artifact.
 * roadmap/25 work item 8; `docs/design/owner-pipeline-conformance.md` §5.5.
 *
 * THE OWNER'S LAST STEP: "a group of specialized agents in documenting must
 * create user guides and maintenance guides that are easy to read and detailed".
 *
 * "Easy to read" is a judgement, and it is a LENS on the stage (`readability`),
 * not a criterion. What a record can decide is COVERAGE — every command
 * documented, every failure mode answered — and one thing more valuable than
 * either: whether the guide's claims are TRUE.
 *
 * WHY THE CLAIMS CHECK IS THE ONE THAT EARNS ITS KEEP. Coverage catches a thin
 * guide, which a reader notices immediately. `unresolvableClaims` catches
 * confident prose about a flag that does not exist, which a reader does NOT
 * notice — they try it, it fails, and they conclude the product is broken rather
 * than the document. That is the failure mode documentation actually has, and it
 * is the difference between a guide and a plausible guide.
 *
 * WHY BOTH GUIDES ARE REQUIRED. The owner named user guides AND maintenance
 * guides. An optional `maintenanceGuide` would let the stage close having
 * written one of the two, and the missing one is always the maintenance guide —
 * it is the less rewarding to write and the more expensive to lack at 3am.
 */

const GuideSchema = z.object({
  /** Where the guide lives, so a later check can open it. */
  path: NonEmptyStringSchema,
});

export const UserGuideSchema = GuideSchema.extend({
  /** Commands and tools this guide documents, by their exact public name. */
  documentsCommands: z.array(NonEmptyStringSchema).default([]),
}).strict();

export const MaintenanceGuideSchema = GuideSchema.extend({
  /** Operational failure modes this guide tells an operator how to handle. */
  documentsFailureModes: z.array(NonEmptyStringSchema).default([]),
}).strict();

export const DocumentationRecordSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    changeSetId: IdSchema,
    userGuide: UserGuideSchema,
    maintenanceGuide: MaintenanceGuideSchema,
  })
  .strict();
export type DocumentationRecord = z.infer<typeof DocumentationRecordSchema>;

/**
 * What the product actually has, supplied by the SERVER.
 *
 * Never by the record under review: a guide supplying its own list of what it
 * must cover could omit the awkward commands, which is the same reason
 * `design-addresses-every-acceptance-criterion` is scored against the
 * `Requirement`s rather than against the design's own claims.
 */
export interface DocumentedSurface {
  readonly commands: readonly string[];
  readonly failureModes: readonly string[];
}

export const DOCUMENT_USER_GUIDE_CRITERION = "document-user-guide-covers-every-command";
export const DOCUMENT_FAILURE_MODES_CRITERION =
  "document-maintenance-guide-covers-every-failure-mode";
export const DOCUMENT_CLAIMS_RESOLVE_CRITERION = "document-claims-resolve";

/**
 * Everything the guides claim that the product does not have.
 *
 * Returns the names rather than a boolean, and covers both guides in one list:
 * the reader's next move is identical either way — go and check whether it
 * exists — and splitting them would make a caller ask twice.
 */
export function unresolvableClaims(
  record: DocumentationRecord,
  surface: DocumentedSurface,
): readonly string[] {
  const commands = new Set(surface.commands);
  const failureModes = new Set(surface.failureModes);
  return [
    ...record.userGuide.documentsCommands.filter((name) => !commands.has(name)),
    ...record.maintenanceGuide.documentsFailureModes.filter((mode) => !failureModes.has(mode)),
  ];
}

/**
 * The documentation criteria the RECORD decides.
 *
 * Each coverage guard requires a non-empty surface first. "Every command is
 * documented" over a surface nobody supplied is trivially true, and would close
 * the stage on an empty guide — the vacuity failure this package has now guarded
 * against at six separate criteria.
 *
 * The claims criterion has no such guard on purpose: a record that claims
 * nothing has invented nothing, and "this guide makes no false claims" is
 * honestly true of it. Coverage is what an empty guide fails, and it fails it.
 */
export function deriveDocumentationCriteria(
  record: DocumentationRecord,
  surface: DocumentedSurface,
): readonly string[] {
  const derived: string[] = [];
  const documented = new Set(record.userGuide.documentsCommands);
  if (surface.commands.length > 0 && surface.commands.every((name) => documented.has(name))) {
    derived.push(DOCUMENT_USER_GUIDE_CRITERION);
  }

  const answered = new Set(record.maintenanceGuide.documentsFailureModes);
  if (surface.failureModes.length > 0 && surface.failureModes.every((m) => answered.has(m))) {
    derived.push(DOCUMENT_FAILURE_MODES_CRITERION);
  }

  if (unresolvableClaims(record, surface).length === 0) {
    derived.push(DOCUMENT_CLAIMS_RESOLVE_CRITERION);
  }
  return derived;
}

/**
 * Criteria the record actively CONTRADICTS.
 *
 * An invented command is evidence AGAINST `document-claims-resolve`, so an
 * attestation claiming it is void rather than merely unsupported. Thin coverage
 * contradicts nothing — a guide covering one of two commands has not lied about
 * anything, and flattening "incomplete" into "false" would make the two
 * indistinguishable in the report the owner reads.
 */
export function documentationContradictions(
  record: DocumentationRecord,
  surface: DocumentedSurface,
): readonly string[] {
  return unresolvableClaims(record, surface).length > 0 ? [DOCUMENT_CLAIMS_RESOLVE_CRITERION] : [];
}
