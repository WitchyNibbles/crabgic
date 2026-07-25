import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceRecord, RemoteResource, Requirement } from "@eo/contracts";
import { buildTraceabilityView, type RemoteEvidencePointer } from "@eo/gates";
import { buildCheckResult, type AttestationCheckResult } from "./checkResult.js";
import { readReleaseRequirements } from "./releaseRequirements.js";

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
 *
 * An empty requirement set is a FAIL, never a vacuous PASS: "every
 * requirement is traced" is trivially true of zero requirements, and that
 * is precisely the silent-PASS failure mode `e2e/report`'s generator
 * exists to prevent.
 */
export const TRACEABILITY_INPUT_PATH = "docs/evidence/phase-23/requirement-traceability.json";

export interface CheckRequirementTraceabilityInput {
  readonly releaseCandidateObjectId: string;
  readonly requirements: readonly Requirement[];
  readonly evidenceRecords: readonly EvidenceRecord[];
  readonly remoteResources: readonly RemoteResource[];
  readonly pointers: readonly RemoteEvidencePointer[];
}

export function checkRequirementTraceability(
  input: CheckRequirementTraceabilityInput,
): AttestationCheckResult {
  const reasons: string[] = [];
  const details: string[] = [];

  if (input.requirements.length === 0) {
    return buildCheckResult(
      [
        `no requirements recorded for the release candidate (expected 21's traceability input at ` +
          `${TRACEABILITY_INPUT_PATH}) — an empty requirement set is never treated as "everything is traced".`,
      ],
      [`release candidate: ${input.releaseCandidateObjectId}`],
    );
  }

  const view = buildTraceabilityView({
    requirements: input.requirements,
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

interface TraceabilityInputFile {
  readonly remoteResources?: readonly RemoteResource[];
  readonly pointers?: readonly RemoteEvidencePointer[];
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
 * live Jira/Grafana revision needs a live sandbox, and none is available in
 * every environment. Their absence is not papered over — the check reports
 * every requirement that lacks a confirmed remote revision.
 */
export function readRequirementTraceabilityInput(
  repoRoot: string,
  releaseCandidateObjectId: string,
  evidenceRecords: readonly EvidenceRecord[],
): CheckRequirementTraceabilityInput {
  const path = join(repoRoot, TRACEABILITY_INPUT_PATH);
  const parsed: TraceabilityInputFile = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf-8")) as TraceabilityInputFile)
    : {};

  // `buildTraceabilityView` reads only `id` and `workUnitIds` off a
  // Requirement; the release corpus has no work units of its own (its
  // "work" is the whole release), so the mapping is empty by construction
  // rather than by omission.
  const requirements: readonly Requirement[] = readReleaseRequirements(repoRoot).map(
    (requirement) => ({ id: requirement.id, workUnitIds: [] }) as unknown as Requirement,
  );

  return {
    releaseCandidateObjectId,
    requirements,
    evidenceRecords,
    remoteResources: parsed.remoteResources ?? [],
    pointers: parsed.pointers ?? [],
  };
}
