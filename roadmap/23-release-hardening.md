# Phase 23 — Release hardening & publication

| | |
|---|---|
| **Depends on** | 00, 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22 (all — README's phase-index row for 23 lists "all") |
| **Unlocks** | — (terminal phase; nothing in the roadmap depends on 23) |
| **Sources** | original plan "Test and acceptance plan" + "Release requires" checklist; adaptation §0 (confirmed decisions), §9 (sequence deltas + new test-matrix items), §10 (risks 1–11), Appendix A (fact inventory); `docs/engine-baseline.md` (00) |
| **Primary package** | none dedicated — cross-cutting over all 18 workspace packages (Gap 3: `engine-core` counted, `renderer-core` is a `packages/contracts` module, not a 19th package). Phase-23-owned harness/tooling lives under top-level `e2e/` (not an npm workspace member) |

## Goal

When this phase is done, `engineering-orchestrator` v1.0.0 is installable from npm and the Claude Code plugin marketplace, every release-gate checklist item is backed by an `EvidenceRecord` from a live or containerized run of the release-candidate object ID — never a fake-engine substitute — and the reproducible build, security review, and compatibility documentation are complete. Before this phase, every subsystem (00–22) is proven only against fakes, cassettes, and unit/integration fixtures; after it, the whole system has been proven end-to-end against disposable live Jira/Grafana environments and the real Claude Code engine, and is publicly shippable.

## In scope

Every item below re-runs already-built (00–22) verification logic against live/containerized infrastructure and the frozen release-candidate object ID — this phase does not re-implement any check; it provisions, wires, executes, and evidences them at release scale.

- **Release-gate report generator** (`e2e/release-gate-report.json`) reading the journal (04) `EvidenceRecord`s and scoring every checklist item in Exit criteria.
- **Disposable-environment provisioning + guaranteed-teardown scripts**: Jira Cloud sandbox tenant; Jira DC 10.3 + 11.3 containers (19); Grafana OSS/Enterprise 11.6/12.4/13.1 containers + Cloud cassette refresh (20); nothing survives a forced abort.
- **Installation-matrix harness** against 10: empty dir, invalid `.git`, unborn HEAD, dirty repo, monorepo, config drift, interrupted upgrade, rollback, uninstall preserving user edits.
- **Orchestration-matrix harness** against 05/13: independent parallel change sets, dependent serialization, cancellation, target drift, worker crash, manager crash, idempotent resume, limit-parked resume (`WorkUnitAttemptStatus: parked:rate_limit`) surviving a supervisor restart.
- **Git-invariance + neutral-rendering matrix harness** against 07/08: checkout invariance; conflicts, renames, SHA-256 repos, submodules, LFS, filters, hooks; branch/commit goldens incl. attribution-leak fixtures.
- **Neutral-communication + connector-security + exactly-once matrix harness** against 17/16/18/19/20: golden/property suites across every artifact class incl. Unicode attacks and secret leakage; exact-origin credential binding, custom CAs, redirects, SSRF, tenant boundaries, error redaction, forged delete/admin, raw-tool denial; crash before/after remote commit, replay, changed-payload rejection, ambiguous reconciliation without duplication.
- **Jira/Grafana live-conformance run**: Cloud v3 + DC 10.3/11.3 full flows incl. 401/403/409/429, malformed pages, ambiguous timeouts; Grafana Cloud + 11.6/12.4/13.1 flows, managed-alert conflicts, API-migration routing, notification side-effect classification; DC/Grafana vendor support windows re-confirmed current, fixtures refreshed if moved (19's own deferred note).
- **No-destructive-surface + data-minimization audit**: public schemas/capabilities contain no delete/admin op; forged actions fail pre-network; attachment bytes/raw telemetry never enter prompts; O(page) pagination; projection budgets; no N+1.
- **Quality/security/perf/learning re-run**: seeded-fault matrices from 14/15/22 executed on the frozen release-candidate object ID, not a synthetic fixture.
- **Supervisor idle-budget re-measurement** (05's <100 MiB RSS / <1% core / 5 s heartbeat numbers) on a quiet host, per 05's and 15's own deferred notes.
- **`@live` full-system conformance**: pinned Claude Code version range (00); hermeticity + sandbox self-tests on a clean host; full 8-family gateway MCP tool-surface completeness — zero `NOT_IMPLEMENTED` remaining across 09's CLI and 16's gateway (Gap 1/Gap 2's explicit phase-23 release-gate obligation).
- **Security review pass**: `docs/threat-model.md` (02) vs. implementation, focused on the 03/16 security keystones and 17's blocking-lint surface.
- **ARM64 verification**: real-hardware (or explicitly documented substitute) ARM64 build+test pass, closing 01's deferred CI gate if ARM64 runners were unavailable earlier.
- **Docs**: `docs/compatibility-matrix.md` (Claude Code tested range; Jira Cloud/DC 10.3/11.3; Grafana Cloud/OSS/Enterprise 11.6/12.4/13.1; Linux x86-64/ARM64 + WSL2), `docs/operator-guide.md`, `docs/security-posture.md`, `docs/upgrade-guide.md`.
- **Reproducible release pipeline**: npm build with provenance; `npm view engineering-orchestrator` re-check against 01's recorded result; SHA-pinned `marketplace.json` entry cut at the release commit (10's mechanism, plugin already quarantine-approved per 12); `CHANGELOG.md` via changesets; publication dry-run before the real publish + `v1.0.0` tag.

## Out of scope

- Building the quality/security/coverage/perf gate *logic* itself — owned by 14/15 (this phase runs them on the frozen release candidate, doesn't design them).
- Building the learning pipeline or its shadow-run mechanics — owned by 22 (this phase only re-runs its seeded-fault matrix).
- Authoring the Jira/Grafana adapter logic or their cassette fixtures — owned by 18/19/20 (this phase consumes their fixtures/containers for live runs).
- The plugin/installer mechanism itself (add-only merge, drift detection, marketplace packaging format) — owned by 10; 23 only cuts and publishes the release-tagged, SHA-pinned entry.
- The `engine-live` CI job's existence and its `@live`-tag wiring — created in 01, wired to the tagged suite in 06 (Gap 15); 23 extends it into the full release-candidate run, doesn't create it.
- `docs/threat-model.md` authorship — owned by 02; 23 only reviews it against the shipped implementation.
- The CLI/gateway command surface itself — owned by 09/16; 23 only verifies zero `NOT_IMPLEMENTED` stubs remain.

## Interfaces produced

Phase 23 is the terminal phase (**Unlocks: —**); no roadmap phase consumes anything produced here. Listed for completeness as the release's external surface and audit trail:

- Published package `engineering-orchestrator@1.0.0` on npm (public access, provenance-attested, Apache-2.0) — consumed by end users / the npm registry, not another phase.
- SHA-pinned `marketplace.json` entry (schema owned by 10) cut at the v1.0.0 release commit — consumed by the Claude Code plugin marketplace / end users.
- `docs/compatibility-matrix.md`, `docs/operator-guide.md`, `docs/security-posture.md`, `docs/upgrade-guide.md` — consumed by operators/end users.
- `CHANGELOG.md` v1.0.0 entry (changesets tool owned by 01) and git tag `v1.0.0`.
- `e2e/release-gate-report.json` (introduced here; phase-23-internal) — the checklist-item → `EvidenceRecord` audit trail, archived by the `release-e2e` CI job (introduced here).

## Interfaces consumed

23 deliberately does **not** use `packages/testkit`'s fakes for its own final verdicts (those are 00–22's dev-time tools) — it re-runs the equivalent seeded-fault vectors against live or containerized real systems instead.

| From | Names consumed | Why 23 needs it |
|---|---|---|
| 00 | `docs/engine-baseline.md` (pinned version + accepted range, every probe verdict); rate-limit error-shape fixture; `spikes/fixtures/` stream-json transcripts | Gates the `@live` run; validates the limit-parking harness reproduces the real signal shape |
| 01 | 18-package npm workspace (Gap 3); CI skeleton (lint/typecheck/unit/coverage, Linux x86-64+ARM64); `engine-live` CI job placeholder; `docs/release-notes-prep.md` (npm name-availability record); Apache-2.0 `LICENSE`/`NOTICE`; changesets skeleton | 23 extends CI with `release-e2e`; re-checks the npm name; executes changesets for the real release; closes the deferred ARM64 gate if 01's runners were unavailable |
| 02 | All 21 contracts; `JournalEntryType` (13 members); `WorkUnitAttemptStatus`; canonical connector-error union (10 members); `CommunicationPolicy` constants; `GATEWAY_MCP_SERVER_NAME`; `docs/threat-model.md` | Release-gate report keys off `EvidenceRecord`/`PerformanceContract`/`LearningProposal`; security review diffs the threat model against the shipped implementation |
| 03 | `EngineAdapter.capabilities()` (`supportsJsonSchema`, `supportsSessionResume`, `permissionModel`, `sandboxModel`, `engineVersion`); envelope-conformance fixture format; golden settings artifacts | Re-run as part of `@live` on the release candidate; golden artifacts diffed for drift |
| 04 | Journal chain + `EvidenceRecord` query surface; `$XDG_STATE_HOME`/`$XDG_CACHE_HOME` layout | Release-gate report generator reads EvidenceRecords directly from the journal |
| 05 | UDS control plane; idle-budget numbers (<100 MiB RSS, <1% core, 5 s heartbeat) | Idle budget re-measured on a quiet host as a release gate (05's own deferred note) |
| 06 | `@live`-tagged conformance suite; version-range gate; `resume`/`forkSession`; `session_id` | Re-run against the pinned range on the release candidate; version gate blocks an untested engine |
| 07 | Invariance harness (tree-hash before/after); worktree quarantine; control clone under `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/git-control/` | Reused directly inside the Git-matrix harness |
| 08 | Local publication routine; branch namer; commit renderer; invariance assertions; "never checked out, never pushed" invariant | Demo-run exit criterion invokes this path directly; re-asserts zero remote interaction |
| 09 | Full CLI surface incl. `gateway mcp` (Gap 2); `doctor --repair-plan`; `evidence <change-set-id>` (Gap 6 clause) | 23 asserts zero `NOT_IMPLEMENTED` remains anywhere on this surface |
| 10 | Installation matrix support; `marketplace.json` (SHA-pinned) mechanism; plugin's quarantine-approved `CapabilityManifest` entry | 23 cuts the release-tagged marketplace entry; installation-matrix harness runs against this installer |
| 11 | Approval-token lifecycle; stop-condition detectors | Exercised live inside the Orchestration matrix |
| 12 | Quarantine-pipeline verdict on the plugin itself; content-addressed capability store | Gates marketplace publication (10's risk note, closed at 23) |
| 13 | DAG executor; limit-parking state machine (`WorkUnitAttemptStatus: parked:rate_limit`); fan-out rationale records | Exercised live; parking-across-restart is an explicit Orchestration-matrix vector |
| 14 | Gate framework; `EvidenceRecord` emission; coverage ratchet; flake-quarantine registry | Re-run on the frozen release-candidate object ID, not a synthetic fixture |
| 15 | PerformanceContract decision engine; twin-worktree A/B runner | Re-run on a quiet host for the release-candidate's real verdicts |
| 16 | Exactly-once mutation pipeline; canonical error union usage; tool surface (`tracker.*`, `observability.*`, `evidence.get`, `evidence.attach`, `result.submit`, `run.status`/`run.cancel` forwarding) | 23 checks full 8-family completeness; exactly-once crash-replay matrix runs against this pipeline |
| 17 | Renderer/lint golden+property corpus; regenerate-once protocol; PR-title/PR-body/review-comment templates | Re-run against real release-candidate payloads; confirms Gap 6's terminal-artifact design (no VCS-host push) |
| 18 | Jira Cloud cassettes + live sandbox; high-impact capability flags (canonical P02 labels: closing transitions, bulk mutations, etc.) | Live matrix; sandbox provisioned early per 18's own note |
| 19 | Jira DC 10.3/11.3 containers; parameterized conformance suite | Live matrix; version-support windows re-confirmed per 19's deferred note |
| 20 | Grafana 11.6/12.4/13.1 + Cloud cassettes; mutation-safety property tests | Live matrix |
| 21 | Drift-CI job; traceability report | Security/evidence review consumes the traceability report; done-transition guard re-verified live |
| 22 | Shadow-run E2E; self-promotion-blocked test; `learn` CLI backends | Re-run as part of the quality/security/perf/learning seeded-fault matrix |

## Work items

1. `e2e/` scaffold + `ReleaseGateReport` schema/generator over 04's journal / 02's `EvidenceRecord` — failing-test-first: generator FAILs a checklist item with zero linked EvidenceRecords, before any harness feeds it real runs.
2. Disposable-environment provisioning + guaranteed-teardown scripts (Jira Cloud sandbox; Jira DC 10.3/11.3 containers per 19; Grafana OSS/Enterprise 11.6/12.4/13.1 containers + Cloud cassette refresh per 20) — failing-test-first: teardown-verification FAILs if a forced-abort leaves any tenant/container alive.
3. Installation-matrix harness against 10 — failing-test-first: harness FAILs on a seeded fixture where the installer silently overwrites a user edit.
4. Orchestration-matrix harness against 05/13, incl. limit-parked resume across a supervisor restart — failing-test-first: harness FAILs on a seeded duplicated side effect from a forced worker crash.
5. Git-invariance + neutral-rendering matrix harness against 07/08 — failing-test-first: harness FAILs on a seeded commit body carrying an attribution leak.
6. Neutral-communication + connector-security + exactly-once matrix harness against 17/16/18/19/20 — failing-test-first: harness FAILs on a seeded confusable-domain fixture and on a seeded replay-with-changed-payload fixture (must be rejected, not silently accepted).
7. `@live` full-system conformance run: pinned-range gate, hermeticity/sandbox self-test on a clean host, gateway MCP 8-family completeness — failing-test-first: run FAILs while any gateway tool family or CLI backend still returns `NOT_IMPLEMENTED`.
8. Security review cycle against `docs/threat-model.md` (02) vs. 03/16/17 implementation — failing-test-first: review BLOCKS while any CRITICAL/HIGH finding is open (mirrors 14's gate semantics).
9. Docs authoring (`docs/compatibility-matrix.md`, `operator-guide.md`, `security-posture.md`, `upgrade-guide.md`) + ARM64 verification close-out — failing-test-first: doc review FAILs if any claim doesn't cite the actual release-candidate object ID or a passing CI run.
10. Reproducible-build + provenance pipeline; publication dry-run, then real publish (npm, SHA-pinned marketplace entry, `CHANGELOG.md`, `v1.0.0` tag) — failing-test-first: dry-run FAILs closed if a from-clean-checkout rebuild's tarball hash mismatches the release build's.

## Test plan

This phase *is* mostly its own test plan — every matrix run emits `EvidenceRecord`s (02/04) that `e2e/release-gate-report.json` scores. Groups below cover the code this phase itself writes (the harness/generator/provisioning tooling), plus the live/conformance/security re-runs it orchestrates.

- **Unit:** `ReleaseGateReport` generator (checklist-item ↔ EvidenceRecord linkage; missing-evidence detection returns FAIL, not PASS-by-default); teardown-verification logic (provisioning-script state machine); tarball-hash comparator for the reproducibility check.
- **Property:** fast-check over random checklist/evidence-set combinations — generator never reports PASS when any linked required EvidenceRecord is absent; report is idempotent (re-running against the same journal segment yields the same verdict).
- **Integration:** the per-matrix harnesses (work items 3–6) against real subsystems in disposable/containerized environments, not fakes — each seeded-fixture fail-first vector above must actually fail before the harness is trusted to certify a real run.
- **Conformance:** `@live` full-system run mapping each of adaptation §9's new test-matrix categories to its owning phase, re-executed here against the frozen release-candidate object ID and the pinned Claude Code version:

  | §9 category | Owning phase(s) (design) | 23's role |
  |---|---|---|
  | Envelope conformance | 03 (unit/property), 06 (live) | Re-run live on the release candidate |
  | Hook enforcement | 03/06 | Re-run live |
  | Sandbox | 00 (spike), 03/06 (compiled profile) | Self-test on a clean host |
  | Hermeticity | 03/06, 09 (doctor self-test) | Re-run live; doctor gate exercised |
  | Structured output | 06 | Re-run live |
  | Sessions | 06 (resume/fork), 13 (parking reuses it) | Kill -9 → resume, and parking-across-restart, both live |
  | Neutrality | 08 (commits), 17 (lint), 10 (post-install) | Re-run against real release-candidate artifacts |
  | Version drift | 06/09 (version gate) | Doctor refuses an untested `claude --version` on the release host |

- **Security:** threat-model-vs-implementation review (02's `docs/threat-model.md` vs. 03/16 keystones + 17's lint surface); forged delete/admin/impersonation-before-network-I/O fixtures (16/18/20); SSRF/redirect/tenant-boundary fixtures (16); secret-leakage/attribution fixtures (17); a seeded CRITICAL/HIGH finding must block release (mirrors 14's gate semantics) — this is not omitted, it's the work item 8 entry point above.

## Exit criteria

- [ ] `release-e2e` CI job's archived `e2e/release-gate-report.json` shows PASS for every item below, each linked to ≥1 `EvidenceRecord` from the exact release-candidate object ID.
- [ ] All applicable quality/security/perf/learning gates (14/15/22) pass on the release candidate with the coverage policy satisfied — not a synthetic fixture.
- [ ] No unresolved CRITICAL/HIGH security finding; threat-model review sign-off recorded with implementation cross-references (03/16/17).
- [ ] Every requirement linked to evidence from the exact final Git object ID and remote (Jira/Grafana) revisions (21's traceability report).
- [ ] Performance contracts satisfied rather than skipped, measured on a quiet host (15).
- [ ] Crash-recovery and concurrent change-set E2E scenarios pass live, including limit-parked resume across a supervisor restart (05/13).
- [ ] Jira/Grafana exactly-once and read-back verification pass live (16/18/19/20).
- [ ] Full 8-family gateway MCP tool surface + full CLI surface return real behavior — zero `NOT_IMPLEMENTED` remains (09/16, Gap 1/Gap 2's explicit phase-23 obligation).
- [ ] No development-engine attribution in any project-controlled shared artifact (08/10/17).
- [ ] No user checkout, remote Git repository, or unauthorized provider resource modified anywhere in the matrix (assertion-harness log).
- [ ] A verified neutral local branch with concise commits and evidence-backed handoff produced by the demo run — the branch plus its evidence bundle (rendered PR-title/PR-body/review-comment artifacts retrievable via `evidence <change-set-id>`), never an opened PR (Gap 6, by design).
- [ ] ARM64 build+test verified on real hardware/CI, or an explicitly documented substitute recorded — closes 01's deferred ARM64 gate.
- [ ] Jira DC / Grafana version-support windows re-confirmed current at release time; fixtures refreshed if vendor support windows moved (19's deferred note).
- [ ] `docs/compatibility-matrix.md`, `operator-guide.md`, `security-posture.md`, and `upgrade-guide.md` are committed, and every claim in them cites a passing CI run or `EvidenceRecord` from the release candidate — no aspirational text.
- [ ] Reproducible build: two independent from-clean-checkout builds of the release tag produce byte-identical tarball hashes; npm provenance attestation present; package published; SHA-pinned marketplace entry cut at the release commit (plugin already quarantine-approved per 12); `v1.0.0` tag created; `CHANGELOG.md` entry present; `npm view engineering-orchestrator` re-check passes.

## Risks & open questions

- **Release velocity (§10 risk 1):** Claude Code ships weekly; any engine version bump during hardening restarts the `@live` conformance clock (00/06 deliberate policy) — schedule hardening to start after a stable window, not mid-bump.
- **Subscription-limit exhaustion during the matrix (§10 risk 9):** live E2E runs share the same subscription rate limits as production workers, and `--max-budget-usd` is meaningless under subscription auth. Mitigation: rely on 13's parking so a rate-limit hit mid-matrix pauses/resumes rather than failing the run; track token/turn usage (not USD) from the result `usage` block; window the matrix run to respect plan limits.
- **Unconfirmed engine facts this phase must not assert on (§10 risk 10, verify-at-build-time):** `MAX_MCP_OUTPUT_TOKENS` and the exact stream-json event taxonomy are unconfirmed per the adaptation doc. The live-conformance harness asserts against 16's gateway-enforced budgets (32 KiB item / 256 KiB result), never against an assumed engine-level token limit; if the taxonomy shifts on a version bump, 06's event-stream parser must be updated before 23 can certify that version — 23 does not independently re-derive the taxonomy.
- **Plugins execute code (§10 risk 11):** marketplace publication is blocked until 12's quarantine pipeline signs off on the plugin bundle itself, not just its declared manifest.
- **ARM64 CI flakiness (01's own risk):** if ARM64 CI runners were unreliable through earlier phases, 23 is where real-hardware verification must close that gap before the tag — this cannot be silently waived.
- **Live-sandbox flakiness/cost:** cassette-first development in 18–20 keeps day-to-day CI cheap; only the release cut runs fully live. Disposable-environment teardown scripts (work item 2) must be crash-safe themselves so an aborted release run never leaves billable resources orphaned.
- Provision live sandboxes during phases 18–20, not here — 23 stands up a fresh (or reused) instance for the release run itself and tears it down; it does not create the provisioning mechanism.
