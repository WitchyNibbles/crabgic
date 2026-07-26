import type { EvidenceRecord } from "@eo/contracts";
import { hasCriterionTagRule, type ReleaseRequirement } from "./releaseRequirements.js";

/**
 * THE ARITHMETIC. `requirement-traceability` has been reported for weeks as
 * "9 of 16 requirements can never link", a figure that was asserted in prose
 * and nowhere derived. This module derives it, from two real inputs only —
 * the requirement corpus parsed out of `roadmap/23-release-hardening.md`'s
 * own `## Exit criteria` bullets, and the `EvidenceRecord`s actually present
 * in the shared release journal — and it distinguishes the four genuinely
 * different reasons a requirement fails to link, because they have four
 * different fixes:
 *
 *  - `unlinkable_umbrella` — the criterion matched a `CRITERION_TAG_RULES`
 *    rule whose `tags` are deliberately `[]` (roadmap/23's lead-in bullet,
 *    "`release-e2e` ... shows PASS for every item below"). It is a statement
 *    ABOUT the report, not an item the report scores — `e2e/report`'s
 *    checklist carries 15 items for exactly this reason while this corpus
 *    carries 16. Structurally unlinkable BY DESIGN. Not a defect.
 *  - `unlinkable_no_tag_rule` — the criterion matched NO rule at all. That
 *    IS a defect: a roadmap bullet nobody tagged, silently untraceable. It
 *    is broken out separately so it can never hide inside the umbrella count.
 *  - `unlinkable_no_emitting_harness` — the requirement has gate tags, but
 *    not one of them appears on any record in the journal. No harness scores
 *    this criterion at all.
 *  - `unlinkable_unstamped_emitter` — a harness DID journal evidence under
 *    one of this requirement's tags, but stamped no `requirementId` on it.
 *    This is the cheap, actionable bucket: the emitters already accept an
 *    optional `requirementId`; no caller supplies one.
 *
 * `buildTraceabilityView` (`@eo/gates`) matches evidence to a requirement on
 * `EvidenceRecord.requirementId` ALONE, which is why an unstamped record —
 * however real, however correctly tagged — contributes nothing to
 * traceability.
 */

export const REQUIREMENT_LINKABILITY_STATUSES = [
  "linked",
  "unlinkable_umbrella",
  "unlinkable_no_tag_rule",
  "unlinkable_no_emitting_harness",
  "unlinkable_unstamped_emitter",
] as const;

export type RequirementLinkabilityStatus = (typeof REQUIREMENT_LINKABILITY_STATUSES)[number];

export interface RequirementLinkabilityEntry {
  readonly requirementId: string;
  readonly text: string;
  readonly gateTags: readonly string[];
  /** This requirement's gate tags that actually appear on at least one journaled record. */
  readonly observedGateTags: readonly string[];
  /** How many journaled records carry this requirement's id. */
  readonly linkedEvidenceCount: number;
  readonly status: RequirementLinkabilityStatus;
}

export interface RequirementLinkabilityReport {
  readonly corpusSize: number;
  readonly linked: number;
  readonly unlinkable: number;
  readonly byStatus: Readonly<Record<RequirementLinkabilityStatus, number>>;
  readonly entries: readonly RequirementLinkabilityEntry[];
  /** Gate tags present in the journal on which NO record anywhere carries a `requirementId` — the actionable emitter-wiring list. */
  readonly unstampedGateTags: readonly string[];
}

export interface AnalyzeRequirementLinkabilityInput {
  readonly requirements: readonly ReleaseRequirement[];
  readonly evidenceRecords: readonly EvidenceRecord[];
  /** Injectable so the four-way status split is testable independently of the real roadmap text; defaults to the real rule table. */
  readonly hasTagRule?: (text: string) => boolean;
}

function emptyCounts(): Record<RequirementLinkabilityStatus, number> {
  return {
    linked: 0,
    unlinkable_umbrella: 0,
    unlinkable_no_tag_rule: 0,
    unlinkable_no_emitting_harness: 0,
    unlinkable_unstamped_emitter: 0,
  };
}

export function analyzeRequirementLinkability(
  input: AnalyzeRequirementLinkabilityInput,
): RequirementLinkabilityReport {
  const hasTagRule = input.hasTagRule ?? hasCriterionTagRule;

  const observedTags = new Set<string>();
  const stampedTags = new Set<string>();
  const linkedCountByRequirementId = new Map<string, number>();
  for (const evidenceRecord of input.evidenceRecords) {
    const gateTag = evidenceRecord.gateTag;
    if (gateTag !== undefined) {
      observedTags.add(gateTag);
      if (evidenceRecord.requirementId !== undefined) stampedTags.add(gateTag);
    }
    const requirementId = evidenceRecord.requirementId;
    if (requirementId !== undefined) {
      linkedCountByRequirementId.set(
        requirementId,
        (linkedCountByRequirementId.get(requirementId) ?? 0) + 1,
      );
    }
  }

  const byStatus = emptyCounts();
  const entries: RequirementLinkabilityEntry[] = input.requirements.map((requirement) => {
    const linkedEvidenceCount = linkedCountByRequirementId.get(requirement.id) ?? 0;
    const observedGateTags = requirement.gateTags.filter((tag) => observedTags.has(tag));

    let status: RequirementLinkabilityStatus;
    if (linkedEvidenceCount > 0) {
      status = "linked";
    } else if (requirement.gateTags.length === 0) {
      status = hasTagRule(requirement.text) ? "unlinkable_umbrella" : "unlinkable_no_tag_rule";
    } else if (observedGateTags.length === 0) {
      status = "unlinkable_no_emitting_harness";
    } else {
      status = "unlinkable_unstamped_emitter";
    }
    byStatus[status] += 1;

    return {
      requirementId: requirement.id,
      text: requirement.text,
      gateTags: requirement.gateTags,
      observedGateTags,
      linkedEvidenceCount,
      status,
    };
  });

  const unstampedGateTags = [...observedTags].filter((tag) => !stampedTags.has(tag)).sort();

  return {
    corpusSize: input.requirements.length,
    linked: byStatus.linked,
    unlinkable: input.requirements.length - byStatus.linked,
    byStatus,
    entries,
    unstampedGateTags,
  };
}

/** One quotable line for the release-gate report's detail column. */
export function summarizeRequirementLinkability(report: RequirementLinkabilityReport): string {
  return (
    `requirement linkability (derived): ${report.corpusSize} requirement(s) from roadmap/23's ` +
    `exit criteria — ${report.linked} linked, ${report.unlinkable} unlinkable ` +
    `[umbrella=${report.byStatus.unlinkable_umbrella}, ` +
    `no_tag_rule=${report.byStatus.unlinkable_no_tag_rule}, ` +
    `no_emitting_harness=${report.byStatus.unlinkable_no_emitting_harness}, ` +
    `unstamped_emitter=${report.byStatus.unlinkable_unstamped_emitter}]`
  );
}
