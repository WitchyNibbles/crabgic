import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceRecord, RemoteResource, Requirement } from "@eo/contracts";
import { buildTraceabilityView, type RemoteEvidencePointer } from "@eo/gates";
import { buildCheckResult, type AttestationCheckResult } from "./checkResult.js";
import { readReleaseRequirements, type ReleaseRequirement } from "./releaseRequirements.js";
import {
  analyzeRequirementLinkability,
  summarizeRequirementLinkability,
  type RequirementLinkabilityStatus,
} from "./requirementLinkability.js";
import {
  describeProvenance,
  parseTraceabilityEvidenceFile,
  type TraceabilityProvenance,
} from "./traceabilityEvidence.js";

/**
 * `requirement-traceability` — roadmap/23 Exit criteria: "Every requirement
 * linked to evidence from the exact final Git object ID and remote
 * (Jira/Grafana) revisions (21's traceability report)."
 *
 * This check does NOT re-implement traceability: it calls 21's own
 * `buildTraceabilityView` (`@eo/gates`) — the module that phase already
 * built and tested — and scores its output against the three things this
 * exit criterion actually demands of every requirement:
 *
 *   1. It is linked to evidence at the EXACT release-candidate object ID.
 *      Evidence from some other commit traces a different artifact.
 *   2. It is bound to at least one remote resource (the Jira/Grafana half
 *      of the sentence).
 *   3. Every such binding carries a CONFIRMED revision — 21's own
 *      `confirmedRevision`, the value its `remote_verification` gate
 *      trusts. A binding without one records "we pointed at it", not "we
 *      verified it".
 *   4. Every remote binding was itself STAMPED at that same object ID.
 *
 * (4) IS NOT REDUNDANT WITH (1), and its absence was a real hole (found by
 * adversarial validation). `buildTraceabilityView` derives
 * `entry.objectIds` from `evidenceRecords` ALONE
 * (`packages/gates/src/traceability-view.ts:94`) and never looks at
 * `RemoteEvidencePointer.objectId`, so before this check existed a pointer
 * stamped at ANY other commit — including one that has since been
 * superseded by a newer HEAD — was silently counted as a valid remote
 * binding for the current release candidate. The exit criterion says
 * "linked to evidence from the exact final Git object ID AND remote
 * revisions": both halves must sit at the same object ID, or the gate is
 * asserting more than it verifies. The artifact's own
 * `provenance.releaseCandidateObjectId` is checked for the same reason —
 * a traceability artifact captured against an earlier commit describes a
 * different release candidate, and its staleness must be a stated reason,
 * never silence.
 *
 * An empty requirement set is a FAIL, never a vacuous PASS: "every
 * requirement is traced" is trivially true of zero requirements, and that
 * is precisely the silent-PASS failure mode `e2e/report`'s generator
 * exists to prevent.
 */
export const TRACEABILITY_INPUT_PATH = "docs/evidence/phase-23/requirement-traceability.json";

export interface CheckRequirementTraceabilityInput {
  readonly releaseCandidateObjectId: string;
  /**
   * The release corpus, carrying each criterion's text and `release-gate:*`
   * tags — NOT bare `Requirement`s. `buildTraceabilityView` needs only
   * `id`/`workUnitIds`, but the linkability arithmetic
   * (`./requirementLinkability.ts`) needs the tags, and keeping two parallel
   * arrays in step is exactly the misalignment this check exists to catch.
   */
  readonly requirements: readonly ReleaseRequirement[];
  readonly evidenceRecords: readonly EvidenceRecord[];
  readonly remoteResources: readonly RemoteResource[];
  readonly pointers: readonly RemoteEvidencePointer[];
  /** Set iff the on-disk traceability artifact exists but could not be parsed/validated — a stated FAIL reason, never a silent empty binding set. */
  readonly artifactProblem?: string;
  /** The artifact's own declared origin, surfaced so the release-gate report states it (containerized vs anything else). */
  readonly remoteBindingProvenance?: TraceabilityProvenance;
}

/** The four unlinkable statuses, each with the sentence that says what a reader must actually DO about it. */
const UNLINKABLE_EXPLANATIONS: Readonly<Record<RequirementLinkabilityStatus, string | undefined>> =
  {
    linked: undefined,
    unlinkable_umbrella:
      "structurally unlinkable by design — this is roadmap/23's umbrella bullet ABOUT the report " +
      "(it maps to `tags: []`), which is why e2e/report's checklist scores 15 items while this " +
      "corpus carries 16",
    unlinkable_no_tag_rule:
      "matched NO CRITERION_TAG_RULES entry at all — an untagged roadmap bullet, silently " +
      "untraceable; add a rule for it",
    unlinkable_no_emitting_harness: "no harness journals evidence under ANY of its gate tags",
    unlinkable_unstamped_emitter:
      "a harness DOES journal evidence under its gate tag but stamps no `requirementId` on it — " +
      "buildTraceabilityView matches on that field alone, so the record contributes nothing",
  };

export function checkRequirementTraceability(
  input: CheckRequirementTraceabilityInput,
): AttestationCheckResult {
  const reasons: string[] = [];
  const details: string[] = [];

  if (input.artifactProblem !== undefined) {
    reasons.push(
      `${TRACEABILITY_INPUT_PATH} exists but is unusable: ${input.artifactProblem}. ` +
        `No remote binding is read from a file this check cannot validate.`,
    );
  }
  if (input.remoteBindingProvenance !== undefined) {
    details.push(describeProvenance(input.remoteBindingProvenance));
    if (input.remoteBindingProvenance.releaseCandidateObjectId !== input.releaseCandidateObjectId) {
      reasons.push(
        `${TRACEABILITY_INPUT_PATH}: provenance records release candidate ` +
          `${input.remoteBindingProvenance.releaseCandidateObjectId}, but this release cut is ` +
          `${input.releaseCandidateObjectId} — the artifact was captured against a different ` +
          `commit and does not describe this candidate. Re-run the containerized binding ` +
          `(npx vitest run --config e2e/attestation/vitest.live.config.ts) at the final object ID.`,
      );
    }
  }

  // (4) — see this module's doc comment. Checked over the RAW pointers
  // rather than the view, because `buildTraceabilityView` discards
  // `RemoteEvidencePointer.objectId` entirely.
  for (const pointer of input.pointers) {
    if (pointer.objectId !== input.releaseCandidateObjectId) {
      reasons.push(
        `${pointer.requirementId}: remote binding to ${pointer.remoteResourceId} was stamped at ` +
          `Git object ID ${pointer.objectId}, not the release candidate ` +
          `${input.releaseCandidateObjectId} — it binds a different commit's artifact.`,
      );
    }
  }

  if (input.requirements.length === 0) {
    return buildCheckResult(
      [
        ...reasons,
        `no requirements recorded for the release candidate (expected 21's traceability input at ` +
          `${TRACEABILITY_INPUT_PATH}) — an empty requirement set is never treated as "everything is traced".`,
      ],
      [...details, `release candidate: ${input.releaseCandidateObjectId}`],
    );
  }

  // THE ARITHMETIC (WP4 blocker 2), derived from the corpus + the journal
  // actually supplied — never a figure carried forward in prose.
  const linkability = analyzeRequirementLinkability({
    requirements: input.requirements,
    evidenceRecords: input.evidenceRecords,
  });
  details.push(summarizeRequirementLinkability(linkability));
  if (linkability.unstampedGateTags.length > 0) {
    details.push(
      `gate tags journaled with NO requirementId on any record (the actionable emitter-wiring ` +
        `gap): ${linkability.unstampedGateTags.join(", ")}.`,
    );
  }
  for (const entry of linkability.entries) {
    const explanation = UNLINKABLE_EXPLANATIONS[entry.status];
    if (explanation !== undefined) {
      reasons.push(`${entry.requirementId}: ${entry.status} — ${explanation}.`);
    }
  }

  const view = buildTraceabilityView({
    requirements: input.requirements.map(
      (requirement) => ({ id: requirement.id, workUnitIds: [] }) as unknown as Requirement,
    ),
    evidenceRecords: input.evidenceRecords,
    remoteResources: input.remoteResources,
    pointers: input.pointers,
  });

  for (const entry of view.entries) {
    if (!entry.objectIds.includes(input.releaseCandidateObjectId)) {
      reasons.push(
        `${entry.requirementId}: no evidence at the release-candidate object ID ` +
          `${input.releaseCandidateObjectId} (linked object IDs: ${entry.objectIds.join(", ") || "none"}).`,
      );
    }
    if (entry.remoteResources.length === 0) {
      reasons.push(`${entry.requirementId}: bound to no remote (Jira/Grafana) resource.`);
      continue;
    }
    const unconfirmed = entry.remoteResources.filter(
      (binding) => binding.confirmedRevision === undefined,
    );
    if (unconfirmed.length > 0) {
      reasons.push(
        `${entry.requirementId}: ${unconfirmed.length} remote binding(s) carry no confirmed revision — ` +
          `${unconfirmed.map((binding) => binding.remoteResourceId).join(", ")}.`,
      );
    }
    details.push(
      `${entry.requirementId}: ${entry.workUnitIds.length} work unit(s), ` +
        `${entry.objectIds.length} object ID(s), ${entry.remoteResources.length} remote binding(s).`,
    );
  }

  return buildCheckResult(reasons, details);
}

/**
 * Assembles 21's traceability inputs for the release cut.
 *
 * The requirement corpus is DERIVED from roadmap/23's own exit criteria
 * (`releaseRequirements.ts`) rather than read from a hand-written file —
 * the release has never been through 11's intake, so there is no
 * `IntentContract` to read, and writing the corpus by hand would make the
 * traceability claim circular.
 *
 * `evidenceRecords` come from 04's journal (the caller supplies them, since
 * the journal location is a release-run concern). Remote resources and
 * evidence pointers still come from an artifact: binding a requirement to a
 * live Jira/Grafana revision needs a live or containerized sandbox, and none
 * is available in every environment. Their absence is not papered over — the
 * check reports every requirement that lacks a confirmed remote revision.
 *
 * THE ARTIFACT IS VALIDATED, NEVER TRUSTED. It used to be read as a bare
 * `JSON.parse(...) as TraceabilityInputFile`: malformed JSON threw straight
 * out of the check and aborted the release-evidence run, and a structurally
 * wrong file degraded silently to `{}` — reported downstream as "bound to no
 * remote resource" rather than "your traceability artifact is corrupt". Both
 * are now stated reasons (`./traceabilityEvidence.ts`), and the artifact's
 * own provenance is carried through so the release-gate report says on its
 * face whether the binding came from a containerized run.
 */
export function readRequirementTraceabilityInput(
  repoRoot: string,
  releaseCandidateObjectId: string,
  evidenceRecords: readonly EvidenceRecord[],
): CheckRequirementTraceabilityInput {
  const path = join(repoRoot, TRACEABILITY_INPUT_PATH);
  const artifact = existsSync(path)
    ? parseTraceabilityEvidenceFile(readFileSync(path, "utf-8"))
    : undefined;

  // The corpus is passed through WHOLE (text + gate tags). `checkRequirement
  // Traceability` narrows it to the `{id, workUnitIds: []}` shape
  // `buildTraceabilityView` reads — the release corpus has no work units of
  // its own (its "work" is the whole release), so that mapping is empty by
  // construction rather than by omission — and uses the tags to derive the
  // linkability arithmetic.
  const requirements = readReleaseRequirements(repoRoot);

  if (artifact !== undefined && !artifact.ok) {
    return {
      releaseCandidateObjectId,
      requirements,
      evidenceRecords,
      remoteResources: [],
      pointers: [],
      artifactProblem: artifact.error,
    };
  }

  return {
    releaseCandidateObjectId,
    requirements,
    evidenceRecords,
    remoteResources: (artifact?.file.remoteResources ?? []) as readonly RemoteResource[],
    pointers: (artifact?.file.pointers ?? []) as readonly RemoteEvidencePointer[],
    ...(artifact !== undefined ? { remoteBindingProvenance: artifact.file.provenance } : {}),
  };
}
