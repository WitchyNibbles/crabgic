/**
 * Materiality classifier — roadmap/21-connector-evidence-integration.md
 * work item 4: "conservative field allow-list (summary/description/
 * acceptance-criteria ONLY) over 18's milestone revision diffs; fires 11's
 * `material amendment` stop condition (reached transitively 21→14→13→11 —
 * this phase SUPPLIES the signal, 11 owns the mechanics)."
 *
 * The allow-list stays conservative until 22's learning loop proposes a
 * tuned version (roadmap/21 §Risks & open questions) — never silently
 * widened here.
 */

export const MATERIAL_TRACKED_FIELDS = ["summary", "description", "acceptance-criteria"] as const;
export type MaterialTrackedField = (typeof MATERIAL_TRACKED_FIELDS)[number];

const TRACKED_FIELD_SET: ReadonlySet<string> = new Set(MATERIAL_TRACKED_FIELDS);

/** One field-level diff between two consecutive milestone polls of the same tracked remote resource. */
export interface FieldDiff {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

export interface MaterialityResult {
  readonly material: boolean;
  /** Which tracked fields (of `MATERIAL_TRACKED_FIELDS`) actually changed — `[]` when `material` is `false`. */
  readonly materialFields: readonly MaterialTrackedField[];
}

/**
 * Classifies a set of field-level diffs. `material` is `true` iff AT LEAST
 * ONE diff touches a tracked field (`summary`/`description`/
 * `acceptance-criteria`) AND actually changed value (`before !== after`).
 * A diff entry present with `before === after` is a no-op and never counts
 * as material, tracked field or not. Diffs touching only non-tracked
 * fields (watchers, labels, assignee, etc.) never flip `material` to
 * `true`, no matter how many of them there are.
 */
export function classifyMateriality(diffs: readonly FieldDiff[]): MaterialityResult {
  const materialFields = diffs
    .filter((d) => d.before !== d.after && TRACKED_FIELD_SET.has(d.field))
    .map((d) => d.field as MaterialTrackedField);
  return { material: materialFields.length > 0, materialFields };
}

/** The signal fed to 11's `material amendment` stop condition (roadmap/21 supplies this; 11 owns re-approval mechanics). */
export interface MaterialAmendmentSignal {
  readonly requirementId: string;
  readonly material: boolean;
  readonly materialFields: readonly MaterialTrackedField[];
}

export function buildMaterialAmendmentSignal(
  requirementId: string,
  diffs: readonly FieldDiff[],
): MaterialAmendmentSignal {
  const result = classifyMateriality(diffs);
  return { requirementId, material: result.material, materialFields: result.materialFields };
}
