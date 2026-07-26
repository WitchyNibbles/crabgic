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
 *     literals (not imported from `@crabgic/gates`) to keep this project's
 *     dependency edge to exactly `@crabgic/contracts` + `@crabgic/journal`, per this
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
      // Phase-23 integration/reconciliation (this work item): `e2e/live`'s
      // harness (roadmap/23 work item 7) is this repo's own end-to-end
      // "everything still actually works" conformance sweep — its
      // dedicated `release-gate:live-conformance` umbrella tag (pinned-
      // engine-range gate + hermeticity/sandbox self-test) and its
      // `release-gate:not-implemented-sweep` tag (zero-NOT_IMPLEMENTED
      // dispatch/production-wiring sweep) are both accepted here as
      // additional quality-gate evidence alongside the existing 14/15/22
      // tags, since both prove exactly the kind of "still conforms, still
      // real behavior" property this item's description covers.
      "release-gate:live-conformance",
      "release-gate:not-implemented-sweep",
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
    requiredGateTags: [
      "release-gate:jira-grafana-exactly-once",
      // Phase-23 integration/reconciliation (this work item): `e2e/matrix/
      // connector`'s harness (roadmap/23 work item 6) journals every one of
      // its scenarios — including its exactly-once suite
      // (`src/exactly-once/{jira-cassette-readback,replay-changed-payload,
      // crash-recovery,grafana-cassette,ambiguous-reconciliation}.test.ts`,
      // the direct exact-once/read-back proof this item describes) — under
      // one blanket harness-wide tag, `release-gate:connector-matrix`
      // (`e2e/matrix/connector/src/support/evidence.ts`). Accepted here so
      // those scenarios' evidence actually scores this item.
      "release-gate:connector-matrix",
    ],
  },
  {
    id: "gateway-cli-surface-complete",
    description:
      "Full 8-family gateway MCP tool surface + full CLI surface return real behavior — zero " +
      "NOT_IMPLEMENTED remains (09/16, Gap 1/Gap 2's explicit phase-23 obligation).",
    required: true,
    requiredGateTags: [
      "release-gate:gateway-cli-surface-complete",
      // Phase-23 integration/reconciliation (this work item): `e2e/live`
      // (roadmap/23 work item 7) is this exit criterion's own harness — the
      // zero-NOT_IMPLEMENTED sweep (`notImplementedSweepGate.ts`) already
      // emits `release-gate:gateway-cli-surface-complete` itself on a PASS
      // verdict, but every run (pass or fail) also always emits its own
      // dedicated `release-gate:not-implemented-sweep` tag, and the
      // harness's broader conformance umbrella emits
      // `release-gate:live-conformance` (pinned-engine-range gate +
      // hermeticity/sandbox self-test). Both are accepted here too so a
      // FAILing sweep run (which withholds the dedicated tag by design —
      // see `notImplementedSweepGate.ts`'s own doc comment) still surfaces
      // as linked evidence against this item instead of silently vanishing,
      // and so the harness's other live-conformance evidence scores this
      // item as well.
      "release-gate:not-implemented-sweep",
      "release-gate:live-conformance",
    ],
  },
  {
    id: "no-engine-attribution",
    description:
      "No development-engine attribution in any project-controlled shared artifact (08/10/17).",
    required: true,
    requiredGateTags: [
      "release-gate:no-engine-attribution",
      // Phase-23 integration/reconciliation (this work item): `e2e/matrix/
      // git`'s harness (roadmap/23 work item 5) journals every scenario —
      // including its attribution-leak proof
      // (`test/publish-attribution-leak-scenario.test.ts`,
      // `test/neutral-rendering-assertion.test.ts`) — under one blanket
      // harness-wide tag, `release-gate:git-matrix`
      // (`e2e/matrix/git/src/evidence.ts`). Accepted here so that evidence
      // actually scores this item.
      "release-gate:git-matrix",
    ],
  },
  {
    id: "no-unauthorized-mutation",
    description:
      "No user checkout, remote Git repository, or unauthorized provider resource modified " +
      "anywhere in the matrix (assertion-harness log).",
    required: true,
    requiredGateTags: [
      "release-gate:no-unauthorized-mutation",
      // Phase-23 integration/reconciliation (this work item): the SAME
      // `release-gate:git-matrix` blanket tag above also covers this
      // item — the harness's checkout/remote-invariance proof
      // (`test/checkout-invariance-scenario.test.ts`) is exactly "no user
      // checkout ... modified" for the git side of the matrix.
      "release-gate:git-matrix",
      // `e2e/matrix/connector`'s harness (work item 6) covers the
      // provider-resource half of this item — its connector-security suite
      // (`src/connector-security/{ssrf-and-dns-rebind,tenant-boundary,
      // forged-delete-admin-and-raw-tool-denial,exact-origin-and-redirects,
      // error-redaction}.test.ts`) asserts no unauthorized Jira/Grafana
      // mutation occurs, under the same blanket `release-gate:
      // connector-matrix` tag used above for the exactly-once item.
      "release-gate:connector-matrix",
      // `e2e/matrix/installation`'s harness (roadmap/23 work item 3) has no
      // dedicated checklist item of its own (there is no
      // "install-matrix"-slugged item in this 15-item list). Its own
      // dominant, repeated proof across its scenario suite
      // (`test/user-edit-assertion.test.ts`'s RED fail-first vector, plus
      // its GREEN counterpart `test/uninstall-preserving-edits-scenario
      // .test.ts`, `test/config-drift-scenario.test.ts`, and
      // `test/repo-state-scenarios.test.ts`) is that install/upgrade/
      // uninstall NEVER silently overwrites a user's own out-of-band edit
      // — i.e. "no unauthorized ... modification" of user-owned content,
      // which is this item's own description almost verbatim. DELIBERATE
      // CHOICE (documented per this work item's own instruction): this is
      // a better fit than `demo-branch-evidence-handoff` (that item is
      // about the demo run's own git-branch/evidence-bundle output, not
      // installation-lifecycle user-edit safety) — the installation
      // matrix's blanket harness-wide tag, `release-gate:
      // installation-matrix` (`e2e/matrix/installation/src/evidence.ts`),
      // is accepted here instead.
      "release-gate:installation-matrix",
    ],
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
      "created; CHANGELOG.md entry present; npm view crabgic re-check passes.",
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
