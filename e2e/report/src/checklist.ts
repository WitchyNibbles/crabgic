/**
 * `RELEASE_GATE_CHECKLIST` — the 15 scored items, one per bullet of
 * roadmap/23-release-hardening.md §Exit criteria (the un-bulleted lead-in
 * line, "`release-e2e` CI job's archived `e2e/release-gate-report.json`
 * shows PASS for every item below, each linked to >=1 `EvidenceRecord`
 * from the exact release-candidate object ID", is the umbrella statement
 * ABOUT this report as a whole — the 15 items below are what it refers to
 * as "every item below", not a 16th scored item itself).
 *
 * Every item is `required: true` — roadmap/23 lists all 15 as unconditional
 * release blockers; the field exists for schema forward-compatibility only
 * (see `schema.ts`'s doc comment).
 *
 * GATE-TAG MATCHING (this work item's own, phase-23-owned design choice):
 * each item declares `requiredGateTags`, a non-empty list of
 * `EvidenceRecord.gateTag` values the generator accepts as satisfying
 * evidence (OR-matched — any one matching tag counts). Two kinds of tag
 * appear:
 *
 *   - A dedicated `release-gate:<slug>` tag, always present on every item.
 *     This is this phase's own sole-definition-site vocabulary: work items
 *     2-10's harnesses (not built by this work item) are expected to
 *     journal their release-scored `EvidenceRecord`s with `gateTag` set to
 *     exactly this string once they exist. Provisional by construction —
 *     documented here as a carry-forward for whichever worker wires each
 *     harness's real evidence emission.
 *   - For the one item that explicitly aggregates already-existing phase
 *     14 gate tags ("all applicable quality/security/perf/learning gates
 *     (14/15/22) pass" - EvidenceRecordSchema's own doc comment: "gate tags
 *     incl. `tdd`, `coverage`, `security`, `engine-conformance`"), those
 *     literal tag strings are ALSO accepted, in addition to this item's own
 *     dedicated tag - real gate firings already emit under them today,
 *     independent of any phase-23 harness. These are copied as plain string
 *     literals (not imported from `@eo/gates`) to keep this project's
 *     dependency edge to exactly `@eo/contracts` + `@eo/journal`, per this
 *     work item's own constraint.
 */

export interface ReleaseGateChecklistItemSpec {
  readonly id: string;
  readonly description: string;
  readonly required: boolean;
  readonly requiredGateTags: readonly string[];
}

export const RELEASE_GATE_CHECKLIST: readonly ReleaseGateChecklistItemSpec[] = [
  {
    id: "quality-security-perf-learning-gates",
    description:
      "All applicable quality/security/perf/learning gates (14/15/22) pass on the release " +
      "candidate with the coverage policy satisfied — not a synthetic fixture.",
    required: true,
    requiredGateTags: [
      "release-gate:quality-security-perf-learning",
      "tdd",
      "coverage",
      "security",
      "engine-conformance",
    ],
  },
  {
    id: "security-review-sign-off",
    description:
      "No unresolved CRITICAL/HIGH security finding; threat-model review sign-off recorded " +
      "with implementation cross-references (03/16 keystones + 17's lint surface).",
    required: true,
    requiredGateTags: ["release-gate:security-review", "security"],
  },
  {
    id: "requirement-traceability",
    description:
      "Every requirement linked to evidence from the exact final Git object ID and remote " +
      "(Jira/Grafana) revisions (21's traceability report).",
    required: true,
    requiredGateTags: ["release-gate:requirement-traceability"],
  },
  {
    id: "performance-contracts",
    description:
      "Performance contracts satisfied rather than skipped, measured on a quiet host (15).",
    required: true,
    requiredGateTags: ["release-gate:performance-contracts"],
  },
  {
    id: "crash-recovery-concurrency",
    description:
      "Crash-recovery and concurrent change-set E2E scenarios pass live, including " +
      "limit-parked resume across a supervisor restart (05/13).",
    required: true,
    requiredGateTags: ["release-gate:crash-recovery-concurrency"],
  },
  {
    id: "jira-grafana-exactly-once",
    description: "Jira/Grafana exactly-once and read-back verification pass live (16/18/19/20).",
    required: true,
    requiredGateTags: ["release-gate:jira-grafana-exactly-once"],
  },
  {
    id: "gateway-cli-surface-complete",
    description:
      "Full 8-family gateway MCP tool surface + full CLI surface return real behavior — zero " +
      "NOT_IMPLEMENTED remains (09/16, Gap 1/Gap 2's explicit phase-23 obligation).",
    required: true,
    requiredGateTags: ["release-gate:gateway-cli-surface-complete"],
  },
  {
    id: "no-engine-attribution",
    description:
      "No development-engine attribution in any project-controlled shared artifact (08/10/17).",
    required: true,
    requiredGateTags: ["release-gate:no-engine-attribution"],
  },
  {
    id: "no-unauthorized-mutation",
    description:
      "No user checkout, remote Git repository, or unauthorized provider resource modified " +
      "anywhere in the matrix (assertion-harness log).",
    required: true,
    requiredGateTags: ["release-gate:no-unauthorized-mutation"],
  },
  {
    id: "demo-branch-evidence-handoff",
    description:
      "A verified neutral local branch with concise commits and evidence-backed handoff " +
      "produced by the demo run — the branch plus its evidence bundle, never an opened PR " +
      "(Gap 6, by design).",
    required: true,
    requiredGateTags: ["release-gate:demo-branch-evidence-handoff"],
  },
  {
    id: "arm64-verification",
    description:
      "ARM64 build+test verified on real hardware/CI, or an explicitly documented substitute " +
      "recorded — closes 01's deferred ARM64 gate.",
    required: true,
    requiredGateTags: ["release-gate:arm64-verification"],
  },
  {
    id: "jira-grafana-version-support-windows",
    description:
      "Jira DC / Grafana version-support windows re-confirmed current at release time; " +
      "fixtures refreshed if vendor support windows moved (19's deferred note).",
    required: true,
    requiredGateTags: ["release-gate:jira-grafana-version-support-windows"],
  },
  {
    id: "release-docs-committed",
    description:
      "docs/compatibility-matrix.md, operator-guide.md, security-posture.md, and " +
      "upgrade-guide.md are committed, and every claim in them cites a passing CI run or " +
      "EvidenceRecord from the release candidate — no aspirational text.",
    required: true,
    requiredGateTags: ["release-gate:release-docs-committed"],
  },
  {
    id: "reproducible-build",
    description:
      "Reproducible build: two independent from-clean-checkout builds of the release tag " +
      "produce byte-identical tarball hashes; npm provenance attestation present; package " +
      "published; SHA-pinned marketplace entry cut at the release commit; v1.0.0 tag " +
      "created; CHANGELOG.md entry present; npm view engineering-orchestrator re-check passes.",
    required: true,
    requiredGateTags: ["release-gate:reproducible-build"],
  },
  {
    id: "engine-pin-recorded",
    description:
      "Release artifact records the exact pinned engine/SDK version " +
      "(@anthropic-ai/claude-agent-sdk, exact-pinned per 01's engine-pin-lint policy); the " +
      "reproducible-build verification asserts the pin is identical in both from-clean-" +
      "checkout tarballs; docs/compatibility-matrix.md states the pinned version alongside " +
      "the tested Claude Code engine version range — evidenced by the engine-pin-lint CI run " +
      "and the tarball manifest check cited in the release-gate report.",
    required: true,
    requiredGateTags: ["release-gate:engine-pin-recorded"],
  },
];
