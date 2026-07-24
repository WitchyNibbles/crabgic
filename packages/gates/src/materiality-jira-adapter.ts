import type { JiraFieldMetadata } from "@eo/connectors-jira";
import {
  MATERIAL_TRACKED_FIELDS,
  type FieldDiff,
  type MaterialTrackedField,
} from "./materiality-classifier.js";

/**
 * Jira field-identifier normalizer — MAJOR-1 fix (adversarial-validation
 * round): feeds `classifyMateriality` from 18's ACTUAL field-identifier
 * space (built-in keys like `summary`/`description`, plus arbitrary
 * `customfield_NNNNN` ids for anything else, including Jira's own
 * "Acceptance Criteria" field, which is ALWAYS a custom field, never a
 * literal `"acceptance-criteria"` key on the wire) rather than a synthetic
 * literal field-name set. Without this bridge, a real acceptance-criteria
 * edit arriving under its actual Jira custom-field id would be silently
 * classified non-material — the dangerous, silent-overwrite direction the
 * validator flagged.
 *
 * Raw Jira issue field snapshots are keyed exactly as 18's own
 * `JiraResourceClient`/`JiraFieldMetadata` model them: built-in fields by
 * their literal name (`summary`, `description`), everything else by its
 * `customfield_NNNNN` id (18's `capability/field-metadata.ts`'s own
 * `CUSTOM_FIELD_ID_PREFIX` convention).
 */
export type JiraIssueFieldSnapshot = Readonly<Record<string, string>>;

const BUILT_IN_FIELD_TO_TRACKED: ReadonlyMap<string, MaterialTrackedField> = new Map([
  ["summary", "summary"],
  ["description", "description"],
]);

const TRACKED_FIELD_LABEL_SET: ReadonlySet<string> = new Set(MATERIAL_TRACKED_FIELDS);

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Maps one raw Jira field id to a tracked semantic field name when
 * possible, else returns the ORIGINAL raw id unchanged — this
 * "unchanged passthrough" is the anti-false-negative AND anti-false-
 * positive contract in one: an id this function can't confidently map to a
 * tracked semantic field is NEVER coerced into one (so it can't spuriously
 * trigger materiality it doesn't mean), but it also never disappears (so a
 * real edit under an id THIS function fails to recognize still shows up in
 * the diff stream as itself, available for a future, wider mapping table —
 * "never silently widened" from `materiality-classifier.ts`'s own
 * conservative-allow-list contract, mirrored here on the identifier side).
 *
 * Resolution order: (1) an exact built-in-field match (`summary`/
 * `description`, Jira's own literal keys — never custom-field-prefixed);
 * (2) for a `customfield_*` id, its DISCOVERED metadata `name` (18's
 * `JiraFieldMetadata.name`), normalized (trimmed, lowercased, spaces ->
 * hyphens) and checked against the tracked label set — e.g. Jira's own
 * "Acceptance Criteria" custom field's discovered name normalizes to
 * `"acceptance-criteria"`, an exact `MATERIAL_TRACKED_FIELDS` match.
 */
export function normalizeJiraFieldId(
  fieldId: string,
  fieldMetadata: readonly JiraFieldMetadata[],
): string {
  const builtIn = BUILT_IN_FIELD_TO_TRACKED.get(normalizeLabel(fieldId));
  if (builtIn !== undefined) return builtIn;

  const metadata = fieldMetadata.find((f) => f.id === fieldId);
  if (metadata === undefined) return fieldId;

  const normalizedName = normalizeLabel(metadata.name);
  return TRACKED_FIELD_LABEL_SET.has(normalizedName) ? normalizedName : fieldId;
}

/**
 * Builds `FieldDiff[]` (materiality-classifier's own input shape) from two
 * raw Jira issue field snapshots (18's actual field-id-keyed shape),
 * normalizing every field id through discovered field metadata FIRST. This
 * is the real bridge between 18's field-identifier space and this phase's
 * 3-member tracked-field allow-list.
 */
export function buildJiraFieldDiffs(
  before: JiraIssueFieldSnapshot,
  after: JiraIssueFieldSnapshot,
  fieldMetadata: readonly JiraFieldMetadata[],
): readonly FieldDiff[] {
  const fieldIds = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diffs: FieldDiff[] = [];
  for (const fieldId of fieldIds) {
    diffs.push({
      field: normalizeJiraFieldId(fieldId, fieldMetadata),
      before: before[fieldId] ?? "",
      after: after[fieldId] ?? "",
    });
  }
  return diffs;
}
