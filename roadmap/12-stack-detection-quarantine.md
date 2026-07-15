# Phase 12 — Stack detection & capability quarantine

| | |
|---|---|
| **Depends on** | 02, 09 |
| **Unlocks** | 14 (gate selection), enriches 11 |
| **Sources** | original plan "Stack detection and capability trust"; adaptation §4.2 (`@anthropic-ai/sandbox-runtime`), §6.3 (Agent Skills context cost), §9 (plugins quarantined too), §10 risk #11 |
| **Primary package** | `packages/detect` |

## Goal

Evidence-based stack profiling that never executes repository content, plus the quarantine pipeline every executable capability — skills, plugins, hooks, MCP servers, scanners — must pass before it becomes a digest-pinned `CapabilityManifest` entry or a callable gateway tool. Done means: `StackEvidence` is always derived from static analysis with zero child-process spawns, and no capability reaches a manager or worker session without a recorded fetch → pin → scan → sandboxed-test → human-approval trail.

## In scope

- **Detection:** manifests, lockfiles, language/runtime versions, source composition, CI, containers, infrastructure, migrations, deployment config, observability integrations → `StackEvidence` (02) with confidence, contradictions, unresolved ambiguity. Pure file analysis; never executes repo content.
- **SBOM (optional):** Syft integration — the syft binary is digest-pinned and quarantined first, through this same pipeline (bootstrap problem, see Risks).
- **Skill selection:** stack → relevant Agent Skills only; `disable-model-invocation` for rarely-used ones.
- **Quarantine pipeline:** (1) fetch without credentials → (2) pin immutable digest → (3) verify signature/provenance where available → (4) SBOM + scan deps/licenses/secrets/scripts/hooks/prompts/permissions → (5) test without credentials or egress, inside an `@anthropic-ai/sandbox-runtime` jail (adaptation §4.2 — the standalone package for wrapping non-Claude processes in the engine's own sandbox jail) → (6) manifest entry for approval. Re-audit on digest/permission-footprint change. SLSA/CycloneDX stored as evidence, not proof of benignity.
- **Third-party Claude plugins:** same pipeline before enabling (plugin hooks/`bin` execute code — adaptation §10 risk #11).
- **Content-addressed capability store** under `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/capability-store/` (same convention, pinned in 04).

## Out of scope

- Approval-envelope/IntentContract assembly and the human approval UI itself (11) — this phase supplies `CapabilityManifest` entries and verifies pre-minted tokens; it does not render or drive the approval prompt (09 owns that UX foundation).
- Gateway transport, secret-reference resolution, remote mutation pipeline (16).
- Security/quality gating of produced code changes — SAST, coverage, flake policy (14). This phase gates *capabilities* before they can run at all; it does not gate work-unit diffs.
- Scheduler task-packet execution / DAG dispatch (13). The doc-research packet this phase generates feeds 11's drafting flow only; 13 never depends on this phase.
- Plugin packaging, marketplace listing, installer scaffolding (10). This phase supplies the pipeline any executable capability — including 10's own plugin bundle — passes through; it does not build, install, or publish anything.
- Journal chain/fsync/snapshot mechanics (04). This phase only emits typed entries into it.

## Interfaces produced

- **Detector framework** (`packages/detect`) — pure, per-ecosystem static analysis producing `StackEvidence` (02 schema) instances. Consumed by 11's `project.inspect` ("12 detection when available; graceful degradation before 12" — a soft relationship, no dependency edge back onto this phase) and, per the cross-phase ledger, by 14/15's stack-aware selection — both 14 and 15 now name `StackEvidence` verbatim in their own text (see Risks).
- **Doc-research task-packet generator** — consumed by phase 11's manager-session contract/DAG drafting flow (see 11 work item 2) when available; graceful degradation before 12, mirroring 11's existing stack-detection relationship.
- **Content-addressed capability store** — on disk at `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/capability-store/` (convention pinned in 04). Holds digest-pinned capability entries plus their audit-report artifacts (fetch provenance, SBOM reference, scan findings, sandboxed-test result, decision, timestamp). Consumed by 14 for its own security-scanner toolchain ("tools digest-pinned via 12" — 14's own text) and by 11 (manifest entries surfaced in approval rendering).
- **`CapabilityManifest` entries** (02 schema; this phase populates, does not own) — digest-pinned skill/plugin/hook/MCP-server/external-tool records appended after a quarantine pass. Consumed by 11 (contract assembly + approval-prompt rendering) and by 23 (release gate's SHA-pinned marketplace listing check). P10's own plugin bundle passes through this same pipeline before marketplace publication (per 10's own risk note) even though no 10↔12 dependency edge exists — that pass happens at 23's release-gate stage, not as a 10 build-time dependency.
- **MCP tools `capability.audit`, `capability.approve`** — implementation stays in `packages/detect` (unchanged: no relocation into `packages/gateway`). Both register into the single `eo_gateway` tool registry (`GATEWAY_MCP_SERVER_NAME`, 02) that phase 09's `gateway mcp` command exposes — no new dependency edge, since this phase already depends on 09. `capability.approve` only **verifies** a previously human-minted `trust approve` token; it is never model-satisfiable, mirroring `contract.approve`'s treatment in 11 (adaptation §5.5).
- **CLI `trust review|approve|revoke`** — backend for the command 09 declares (`NOT_IMPLEMENTED` stub until this phase lands). `trust approve` mints a one-time approval token bound to the capability's content digest (parallel in spirit to 09's envelope-hash-bound token, 09 work item 5, but a distinct token keyed to a different subject) and journals it as an `approval_token_mint` entry (`JournalEntryType`, 02 — reused member; see Risks).

## Interfaces consumed

- **From 02** (`packages/contracts`): `StackEvidence` schema (detector-framework output target); `CapabilityManifest` schema (entry target); `GATEWAY_MCP_SERVER_NAME` constant (`"eo_gateway"`) for tool-registry registration; `JournalEntryType`'s `approval_token_mint` member (reused here for capability-digest-bound tokens); testkit fixture builders for detector/quarantine fixtures.
- **From 09** (`packages/cli`): the `trust review|approve|revoke` command parser/skeleton + typed UDS client (09 work item 1) this phase's backend replaces; the `gateway mcp` extensible tool registry that `capability.audit`/`capability.approve` register into.

## Work items

1. Detector framework (pure per-ecosystem detectors) + evidence/confidence model + contradiction reporting, populating `StackEvidence`.
2. Doc-research task-packet generator (consumed by phase 11's manager-session contract/DAG drafting flow — see 11 work item 2 — when available; graceful degradation before 12, mirroring 11's existing stack-detection relationship).
3. Content-addressed capability store at `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/capability-store/` (pinned in 04) + digest/permission-footprint re-audit triggers.
4. Pipeline stages with pluggable pinned scanners (gitleaks, osv-scanner, Syft) + audit-report artifact; stage 5 sandboxed test via `@anthropic-ai/sandbox-runtime`, writing entries into the store from item 3.
5. `capability.audit`/`capability.approve` MCP tools (registered into 09's `gateway mcp` registry) + CLI `trust review|approve|revoke` backend; `trust approve` mints, `capability.approve` only verifies.

## Test plan

All vectors below are written red before their corresponding pipeline stage exists (roadmap TDD ground rule).

- **Unit:** per-ecosystem detector fixtures (node/ts monorepo, python, go, rust, mixed, containerized); confidence-scoring and contradiction-flagging cases (e.g. conflicting `engines.node` across a monorepo's packages).
- **Property:** capability-store key is a pure function of (digest, permission footprint) — fast-check over random digest/permission mutations proves any change forces a different key; quarantine stage ordering is total — no fixture reaches a manifest entry having skipped an earlier stage.
- **Integration:** end-to-end quarantine run against fixture candidates (benign npm package, benign Python wheel) built with 02's testkit fixture builders; `capability.audit`/`capability.approve` resolved through a stub MCP client against the shared registry; CLI `trust review|approve|revoke` against a real supervisor in a tmp dir (mirrors 09's own convention); doc-research packet generator invoked with phase 11's flow unavailable → typed degraded fallback, no crash.
- **Conformance:** no-exec jail test — the detector suite fails if any child process spawns while analyzing a fixture repo containing an executable `postinstall` script; digest-pinning reproducibility — two audits of a byte-identical candidate yield the identical digest.
- **Security:** malicious `postinstall` (reverse-shell attempt), secret token embedded in a skill body, over-broad plugin hook (wildcard path / unscoped `Bash(*)`), unsigned digest swapped post-pin, stage-5 sandboxed test attempting network egress (must be denied, `allowedDomains: []`) and attempting to read `~/.ssh` (must be denied, `denyRead`); model-self-approval fixture against `capability.approve` (must fail closed with no pre-minted token).

## Exit criteria

- [ ] Fixture matrix (node/ts monorepo, python, go, rust, mixed, containerized) yields expected `StackEvidence` profiles; contradictions surfaced on conflicting fixtures.
- [ ] No-execution proof: detectors run under a no-exec jail test that fails if any child process spawns.
- [ ] Quarantine catches seeded threats: malicious postinstall, secret in skill body, over-broad plugin hook, unsigned digest change.
- [ ] Approved capability is digest-pinned in the manifest under `capability-store/`; a changed digest or permission footprint forces re-audit.
- [ ] `capability.audit`/`capability.approve` resolve over the shared `eo_gateway` registry against a stub MCP client; `capability.approve` rejects a call lacking a pre-minted `trust approve` token.
- [ ] CLI `trust review|approve|revoke` replaces 09's `NOT_IMPLEMENTED` stub end-to-end against a real supervisor in a tmp dir.
- [ ] Doc-research task-packet generator degrades gracefully when invoked before phase 11's drafting flow exists (typed fallback, no crash).

## Risks & open questions

- Scanners are themselves supply chain: gitleaks/osv-scanner/Syft are bootstrapped through this same pipeline with vendored first-trust digests (documented procedure) — adaptation §10 risk #11 (plugins/executables as attack surface) applies to this bootstrap set too.
- **JournalEntryType gap:** capability-quarantine audit decisions have no dedicated member in 02's 13-member `JournalEntryType` union — only `trust approve`'s token minting maps cleanly (`approval_token_mint`, reused from its 09/11 envelope-hash scope for a capability-digest scope instead). The audit pass/fail/contradiction decision itself is currently recorded only in the capability store's own artifact, not the journal. Flagging for 02/the reconciler — adding a union member is outside this phase's authority.
- **Resolved:** `docs/threat-model.md`'s STRIDE surface list (02) now explicitly enumerates the capability-quarantine pipeline alongside connectors/renderer/learning-store — 02's own Risks section confirms this line item was added specifically "closing gaps flagged by 12 and 17 respectively." No further action needed.
- **Resolved:** `StackEvidence` consumption by 14/15 is confirmed verbatim in both phases' own text — 14's In-scope "Test execution" bullet names `StackEvidence` directly and its Risks section explicitly resolves this gap (spelling out the `ProjectProfile`↔`StackEvidence` split: `ProjectProfile` says *how* to run a stack's own tests, `StackEvidence` says *whether* a gate category applies at all); 15's In-scope "Risk detection" bullet also cites `StackEvidence` directly. No further reconciler action needed.
- Skill selection (stack → relevant Agent Skills) has no phase currently declaring formal consumption — 10's plugin scaffolding doesn't cite stack-based filtering. Kept as in-scope behavior; the runtime wiring point is unspecified pending 10/11.
- 10's own risk note says its plugin bundle passes this phase's quarantine before marketplace publication, despite no 10↔12 dependency edge existing. No edge is structurally required — the pipeline runs generically against any candidate capability, invoked at 23's release-gate stage — but flagging so the reconciler doesn't read the asymmetry as a missing edge.
- **Verify-at-build-time:** the adaptation doc confirms `@anthropic-ai/sandbox-runtime` exists as a standalone package (§4.2) but does not detail its invocation API for wrapping an arbitrary non-Claude child process (only the engine's own sandbox JSON schema is spelled out). Treat the exact stage-5 harness as a phase-12-local spike before trusting it as a security boundary; reuse 00's sandbox-probe methodology rather than a new cross-phase dependency.
