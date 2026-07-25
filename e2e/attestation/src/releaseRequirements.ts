import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The release's requirement corpus — the decision recorded in
 * `docs/release-gate-remediation-plan.md` (option A): for v1.0.0, "every
 * requirement" means the roadmap's own phase exit criteria.
 *
 * roadmap/23's exit criterion reads "Every requirement linked to evidence
 * from the exact final Git object ID and remote (Jira/Grafana) revisions".
 * Requirements in this system are normally per-ChangeSet, assigned by 11's
 * intake — and the release itself has never been through intake, which is
 * why the traceability item had nothing to score. Rather than invent a
 * corpus, this module derives it from the one place the release's own
 * obligations are actually written down: roadmap/23's `## Exit criteria`
 * checkbox list.
 *
 * IDS ARE DETERMINISTIC AND ARE REAL UUIDS. `EvidenceRecord.requirementId`
 * is `IdSchema` (a UUID), so a readable slug cannot be used. The id is a
 * UUIDv5-style digest of the criterion text, so the same criterion yields
 * the same id on every run and across processes — a requirement's identity
 * survives re-parsing, exactly as 11's own section+title-derived ids do.
 */

export const RELEASE_EXIT_CRITERIA_PATH = "roadmap/23-release-hardening.md";
const EXIT_CRITERIA_HEADING = "## Exit criteria";

/** The UUID namespace this corpus derives its ids in. Fixed, so ids are stable forever. */
const REQUIREMENT_NAMESPACE = "eo-release-requirement";

export interface ReleaseRequirement {
  /** A real UUID — `EvidenceRecord.requirementId` is `IdSchema`. */
  readonly id: string;
  /** The exit-criterion text, verbatim. */
  readonly text: string;
  /** `release-gate:*` tags whose evidence satisfies this requirement, when one is known. */
  readonly gateTags: readonly string[];
}

/**
 * A deterministic, RFC-4122-shaped v5 identifier: sha-1 of
 * namespace + name, with the version and variant nibbles forced.
 */
export function deriveRequirementId(text: string): string {
  const digest = createHash("sha1").update(`${REQUIREMENT_NAMESPACE}:${text}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  // Version 5, RFC-4122 variant.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Extracts the `- [ ]` / `- [x]` bullets under `## Exit criteria`.
 *
 * The umbrella bullet ("`release-e2e` CI job's archived report shows PASS
 * for every item below") is deliberately KEPT: it is an obligation in its
 * own right, and dropping it would quietly shrink the corpus.
 * `e2e/report/src/checklist.ts` makes the opposite call for its own purpose
 * (it scores the 15 items the umbrella refers to, not the umbrella itself),
 * and both are right for what they each do.
 */
export function parseExitCriteria(markdown: string): readonly string[] {
  const start = markdown.indexOf(EXIT_CRITERIA_HEADING);
  if (start === -1) return [];
  const rest = markdown.slice(start + EXIT_CRITERIA_HEADING.length);
  const next = rest.search(/\n## /);
  const section = next === -1 ? rest : rest.slice(0, next);

  const criteria: string[] = [];
  for (const line of section.split("\n")) {
    const match = /^\s*-\s*\[[ xX]\]\s*(.+?)\s*$/.exec(line);
    if (match?.[1] !== undefined) criteria.push(match[1]);
  }
  return criteria;
}

/**
 * Maps an exit criterion to the `release-gate:*` tags whose evidence
 * satisfies it, by matching the distinctive phrase each criterion uses.
 *
 * Deliberately explicit rather than slug-derived: a criterion's wording and
 * its gate slug are not mechanically related (the "No user checkout ...
 * modified" criterion is tagged `no-unauthorized-mutation`), so deriving
 * one from the other would silently mis-link. An unmatched criterion gets
 * NO tags and therefore cannot be traced — which is then reported, never
 * hidden.
 */
const CRITERION_TAG_RULES: readonly { readonly match: RegExp; readonly tags: readonly string[] }[] =
  [
    {
      match: /quality\/security\/perf\/learning gates/i,
      tags: [
        "release-gate:quality-security-perf-learning",
        "tdd",
        "coverage",
        "security",
        "engine-conformance",
      ],
    },
    {
      match: /CRITICAL\/HIGH security finding/i,
      tags: ["release-gate:security-review", "security"],
    },
    {
      match: /Every requirement linked to evidence/i,
      tags: ["release-gate:requirement-traceability"],
    },
    { match: /Performance contracts satisfied/i, tags: ["release-gate:performance-contracts"] },
    { match: /Crash-recovery and concurrent/i, tags: ["release-gate:crash-recovery-concurrency"] },
    {
      match: /exactly-once and read-back/i,
      tags: ["release-gate:jira-grafana-exactly-once", "release-gate:connector-matrix"],
    },
    {
      match: /zero `?NOT_IMPLEMENTED`? remains/i,
      tags: ["release-gate:gateway-cli-surface-complete", "release-gate:not-implemented-sweep"],
    },
    {
      match: /No development-engine attribution/i,
      tags: ["release-gate:no-engine-attribution", "release-gate:git-matrix"],
    },
    {
      match: /No user checkout, remote Git repository/i,
      tags: [
        "release-gate:no-unauthorized-mutation",
        "release-gate:git-matrix",
        "release-gate:connector-matrix",
        "release-gate:installation-matrix",
      ],
    },
    {
      match: /verified neutral local branch/i,
      tags: ["release-gate:demo-branch-evidence-handoff"],
    },
    { match: /ARM64 build\+test verified/i, tags: ["release-gate:arm64-verification"] },
    {
      match: /version-support windows re-confirmed/i,
      tags: ["release-gate:jira-grafana-version-support-windows"],
    },
    {
      match: /compatibility-matrix\.md.*are committed/i,
      tags: ["release-gate:release-docs-committed"],
    },
    { match: /Reproducible build/i, tags: ["release-gate:reproducible-build"] },
    {
      match: /records the exact pinned engine\/SDK version/i,
      tags: ["release-gate:engine-pin-recorded"],
    },
    { match: /archived `?e2e\/release-gate-report\.json`? shows PASS/i, tags: [] },
  ];

export function gateTagsForCriterion(text: string): readonly string[] {
  return CRITERION_TAG_RULES.find((rule) => rule.match.test(text))?.tags ?? [];
}

export function buildReleaseRequirements(
  criteria: readonly string[],
): readonly ReleaseRequirement[] {
  return criteria.map((text) => ({
    id: deriveRequirementId(text),
    text,
    gateTags: gateTagsForCriterion(text),
  }));
}

/** Reads the corpus straight out of the roadmap. */
export function readReleaseRequirements(repoRoot: string): readonly ReleaseRequirement[] {
  const path = join(repoRoot, RELEASE_EXIT_CRITERIA_PATH);
  if (!existsSync(path)) return [];
  return buildReleaseRequirements(parseExitCriteria(readFileSync(path, "utf-8")));
}

/** Reverse index: which requirement a given `release-gate:*` tag evidences. */
export function requirementIdForGateTag(
  requirements: readonly ReleaseRequirement[],
  gateTag: string,
): string | undefined {
  return requirements.find((requirement) => requirement.gateTags.includes(gateTag))?.id;
}
