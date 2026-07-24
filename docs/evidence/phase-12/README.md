# Phase 12 evidence — stack detection & capability quarantine

Governing spec: `roadmap/12-stack-detection-quarantine.md`. Package: `packages/detect`.
Raw gate output (`tsc -b`, `vitest run`, scoped coverage) captured verbatim in
`gate-results.txt`.

## Exit criterion → evidence mapping

| Exit criterion | Test files (evidence) |
|---|---|
| Fixture matrix (node/ts monorepo, python, go, rust, mixed, containerized) yields expected `StackEvidence` profiles; contradictions surfaced on conflicting fixtures | `src/evidence-builder.test.ts` (all 6 named fixtures + a 7th conflicting-fixture case + schema round-trip); fixture builders in `src/test-support/stack-fixtures.ts`; per-detector unit suites `src/detectors/*.test.ts` (10 detectors, one per `StackEvidenceCategory`); `src/contradiction.test.ts` (the `engines.node` conflict example named verbatim in the roadmap) |
| No-execution proof: detectors run under a no-exec jail test that fails if any child process spawns | `src/no-exec-jail.test.ts` (full detection pass against a fixture with an executable `postinstall` reverse-shell script, `node:child_process` module-mocked to record any call — zero recorded); `src/spawn-surface-scan.test.ts` (static, package-wide: no file imports `node:child_process`, no `shell:true`, no bare `spawn`/`exec`/`execFile`/`fork` call anywhere in source) |
| Quarantine catches seeded threats: malicious postinstall, secret in skill body, over-broad plugin hook, unsigned digest change | `src/quarantine/scanners/script-scanner.test.ts`, `secret-scanner.test.ts`, `permission-scanner.test.ts` (each threat individually); `src/quarantine/stages/scan-stage.test.ts` (aggregated, blocking); `src/quarantine/stages/verify-provenance.test.ts` (unsigned digest swap); `src/quarantine/pipeline.test.ts` (all 4 threats end-to-end through the full pipeline, each stopping at the correct stage with `decision: "rejected"` and no manifest entry) |
| Approved capability is digest-pinned in the manifest under `capability-store/`; a changed digest or permission footprint forces re-audit | `src/quarantine/digest.test.ts` (+ property test: reproducibility, order-independence, provenance-independence); `src/quarantine/manifest-entry.test.ts` (schema-valid entry per kind); `src/capability-store/store.test.ts` (real on-disk persistence, `updateDecision`); `src/capability-store/reaudit.test.ts` (digest-changed / permission-footprint-changed both force re-audit); `src/capability-store/key.property.test.ts` (fast-check: key is a pure function of (digest, permissionFootprint)) |
| `capability.audit`/`capability.approve` resolve over the shared `eo_gateway` registry against a stub MCP client; `capability.approve` rejects a call lacking a pre-minted `trust approve` token | `src/mcp/tool-definitions.test.ts` (both tools visible over real stdio `tools/list` via 09's own `createToolRegistry`/`startGatewayMcpServer`, duplicate-registration rejection); `src/mcp/capability-audit-handler.test.ts`; `src/mcp/capability-approve-handler.test.ts` (genuine mint→verify→approve flow; fails closed for: no token, wrong digest, replayed/consumed token, wrong subject-kind token — the "model-self-approval" seeded threat) |
| CLI `trust review\|approve\|revoke` replaces 09's `NOT_IMPLEMENTED` stub end-to-end against a real supervisor in a tmp dir | `src/trust/trust-commands.test.ts` — real on-disk capability store (tmp dir) + real `ApprovalTokenMinter` + real on-disk approval ledger, full `review → approve (mint) → verify → revoke` chain in one process. **Deviation**, see below: does not run against a real `packages/supervisor` UDS process, and is not wired into `packages/cli`'s `dispatch.ts` — both are outside this task's file-scope authority (`packages/detect/` + `docs/evidence/phase-12/` only) |
| Doc-research task-packet generator degrades gracefully when invoked before phase 11's drafting flow exists (typed fallback, no crash) | `src/doc-research/generator.test.ts` (no-consumer → typed `degraded` result, never a throw; consumer present → `submitted`, sync and async consumers both) |

## Gate results (this build)

- `npx tsc -b packages/detect` — clean.
- `npx vitest run packages/detect --coverage.enabled=false` — **196 tests / 40 files, all green**.
- `npx eslint packages/detect` — clean, zero warnings/errors.
- `npx prettier --check packages/detect` — clean (after `prettier --write`).
- Coverage, scoped to `packages/detect/src/**/*.ts` (excluding `*.test.ts`, `dist`,
  `test-support`): **statements 94.72%, branches 86.81%, functions 99.23%, lines
  98.49%** — all four ≥ the 80% ground-rule floor. Full per-file breakdown in
  `gate-results.txt`.

## Adversarial-review fixes (post-initial-build)

An independent adversarial validation pass confirmed the no-code-execution guarantee is
genuinely solid, but found 3 real issues. All fixed here, TDD (failing test first), scoped to
`packages/detect/` only — `packages/cli`/`packages/supervisor` untouched.

| # | Finding | Fix | Regression test |
|---|---|---|---|
| 1 (HIGH, confirmed DoS) | `walkRepoTree` (`src/fs/safe-walk.ts`): `maxEntries` only decremented when a FILE was pushed, and an in-root directory symlink was followed with NO visited-realpath tracking. A directory of `k` self-referential symlinks (`loopN -> .`) with zero regular files recursed with branching factor `k` to `maxDepth` (12) — empirically k=2 ~970ms, k=3 did not finish in 90s (unkillable by `vitest`'s own per-test timeout, since the hang is synchronous CPU-bound recursion, not an async op the event loop can interrupt). `buildStackEvidence` runs this with defaults on any untrusted/cloned project. | Every directory visit (symlinked OR plain) now carries a per-branch `Set` of ancestor realpaths; re-entering a realpath already on the CURRENT ancestor path is refused — turns the traversal into a true tree walk regardless of how symlinks alias real directories. Added a directory-visit budget (reusing `maxEntries`) as defense-in-depth alongside the cycle guard. | `src/fs/safe-walk.test.ts`: `k=6` self-referential-symlink case (root-level and nested-inside-a-real-subdirectory variants), both asserting termination `<2000ms`; a "diamond" case (two distinct branches pointing at the same non-ancestor target) proving the fix does NOT false-positive on legitimate symlink reuse |
| 2 (MEDIUM, confirmed fail-open) | Stage 5 (sandbox_test) was structurally vacuous: `fake-sandbox-runner.ts` hardcoded `passed:true` regardless of `deniedOperations`, so a candidate declaring network egress or a `~/.ssh` read reached stage 6 (`pending`) with the denial only "recorded," never gating anything; an empty/absent `selfTestPlan` sailed through identically to a genuinely-tested-and-clean one. | `createFakeSandboxRunner` now returns `passed: deniedOperations.length === 0` — a real (if in-process) policy verdict. `sandbox-stage.ts` already propagated `sandboxResult.passed` straight through (only its doc comment was wrong); `pipeline.ts`'s existing stage-ordering logic now genuinely REJECTS at `sandbox_test` on any denied operation, never reaching `manifest_entry`. The real OS-jail runtime stays a documented carry-forward (deviation 3, below) — but the STAGE itself now gates on the policy verdict, not a no-op. | `src/quarantine/sandbox/fake-sandbox-runner.test.ts` (passed:false for denied ops, passed:true when all allowed, mixed allowed+denied); `src/quarantine/stages/sandbox-stage.test.ts` (REJECTS for network-egress and `~/.ssh`-read cases); `src/quarantine/pipeline.test.ts` (new `failAt:"sandbox"`-shaped case: stages stop at `sandbox_test`, `decision:"rejected"`, no `manifestEntry`; plus a benign-allowed-operation case still reaching stage 6); `src/quarantine/pipeline.property.test.ts` (extended the stage-ordering totality property to a 5th `failAt: "sandbox"` branch, prefix length 5) |
| 3 (LOW/MEDIUM, confirmed dead guard) | The unsigned-digest-swap provenance guard (stage 3) was unreachable from production: `capability-audit-handler.ts`'s `runCapabilityAudit` computed `reaudit` informationally via `checkReauditRequired` but called `runQuarantinePipeline` WITHOUT threading the store's `previousDigest` for the same capability name — stage 3 only fires when `previousDigest` is supplied, so only a hand-built test injecting it manually ever exercised the guard; a real digest swap through the real handler never triggered it. | `runCapabilityAudit` now resolves `deps.store.findLatestByName(name)` BEFORE running the pipeline and threads its `report.digest` into `runQuarantinePipeline`'s `previousDigest` option (computed strictly before `store.save()`, so it reflects the prior audit, never this one). A real digest change for an already-known capability name with no accompanying valid signature is now genuinely rejected at `verify_provenance` on every real `capability.audit` call, not just reported after the fact. | `src/mcp/capability-audit-handler.test.ts`'s new case: two REAL `runCapabilityAudit` calls (no manual `previousDigest` injection) — first pending, second (different content, same name) asserts `stages === ["fetch","pin","verify_provenance"]`, last stage `passed:false`, `decision:"rejected"`; a companion case proves a byte-identical second audit does NOT trip the guard |

## Public interfaces exported (for downstream phases, especially 14)

All re-exported from `packages/detect/src/index.ts` (`@eo/detect`):

- **Detection framework**: `walkRepoTree`, `readTextBounded`/`parseJsonSafe`, `Detector`/
  `DetectionContext`/`buildDetectionContext`, `ALL_DETECTORS` + the 10 individual detectors
  (`manifestDetector`, `lockfileDetector`, `languageRuntimeDetector`,
  `sourceCompositionDetector`, `ciDetector`, `containerDetector`, `infrastructureDetector`,
  `migrationDetector`, `deploymentConfigDetector`, `observabilityDetector`),
  `detectContradictions`, **`buildStackEvidence(rootDir, options?)`** — the single top-level
  entry point 11's `project.inspect` and 14/15's stack-aware gate selection should call.
- **Quarantine pipeline**: `CandidateSource`/`CandidateSourceSchema`, `PinnedCandidate`,
  `AuditReport`, `PIPELINE_STAGES`, `computeCandidateDigest`, `buildManifestEntry`,
  **`runQuarantinePipeline(rawSource, options?)`** — the single top-level pipeline entry
  point; scanners `secretScanner`/`scriptScanner`/`permissionScanner`/`DEFAULT_SCANNERS`;
  sandbox `SandboxRunner`/`createFakeSandboxRunner`/`DEFAULT_SANDBOX_POLICY`.
- **Capability store**: `resolveCapabilityStoreDir`/`resolveCapabilityEntryDir`,
  `computeCapabilityStoreKey`, `createCapabilityStore` (→ `CapabilityStore`:
  `save`/`load`/`updateDecision`/`list`/`findLatestByName`/`findByDigest`),
  `checkReauditRequired`, `createApprovalLedger`.
- **MCP tools**: `CAPABILITY_AUDIT_TOOL`/`CAPABILITY_APPROVE_TOOL`,
  `registerCapabilityTools(registry)`, `runCapabilityAudit`, `runCapabilityApprove`.
- **Trust CLI backend**: `TrustCommandDependencies`, `runTrustReviewCommand`,
  `runTrustApproveCommand`, `runTrustRevokeCommand`.
- **Doc-research**: `DocResearchPacket`/`DocResearchPacketSchema`, `buildDocResearchPacket`,
  `DocResearchConsumer`, `generateDocResearchPacket`.

14's own gate registry should consume `StackEvidence` (via `buildStackEvidence`) exactly as
02/14's own text already names it, and its security-scanner toolchain should consume the
capability-store's digest-pinned entries (via `createCapabilityStore`) exactly as 14's own
text says ("tools digest-pinned via 12").

## Deviations (documented, in-authority choices)

1. **`packages/detect/tsconfig.json` does NOT reference `../cli`.** `engineering-orchestrator`
   (09's package) is consumed purely through normal Node package resolution (its published
   `dist/index.d.ts`/`dist/index.js`, `skipLibCheck: true`), not a TS project reference. This
   is deliberate: a concurrent, in-progress session was actively editing `packages/cli/src/
   installer/` throughout this build (phase 10's own work, uncommitted, outside this task's
   scope) and repeatedly left `packages/cli`'s OWN source tree in a transiently
   non-compiling state (observed twice: a stray `*/` inside a JSDoc comment prematurely
   closing the comment block — the exact same class of bug this session hit and fixed in its
   own `manifest-detector.ts`; and a corrupted/truncated `dist/installer/git-repo-state.js`
   build artifact). A `references: [{path: "../cli"}]` entry would make `npx tsc -b
   packages/detect` transitively rebuild and re-fail on `packages/cli`'s unrelated,
   in-flux source — decoupling via plain package resolution (which only touches cli's
   already-built `dist/`) is more robust for this package's own build and matches CLAUDE.md's
   "consume its types, do not modify 09's committed code" instruction literally. **Residual
   risk, flagged for the orchestrator:** because `engineering-orchestrator`'s `dist/` is a
   live, concurrently-rebuilt artifact in this environment, a test run of `packages/detect`
   can transiently fail if that dist happens to be mid-rebuild/broken at the exact moment
   (observed once during this session, self-resolved on retry within ~1 minute as the other
   session's own fix landed). This is not a defect in `packages/detect`'s own code — rerunning
   after 09's own build stabilizes is the correct remedy, not editing this package further.
2. **`trust review|approve|revoke` is not wired into `packages/cli/src/commands/dispatch.ts`,
   and does not run against a real `packages/supervisor` process.** Both edits are outside
   this task's file-scope authority (`packages/detect/` + `docs/evidence/phase-12/` only —
   `packages/cli` and `packages/supervisor` are explicitly out of bounds). The full, real
   backend chain is implemented and tested end-to-end in-process
   (`src/trust/trust-commands.test.ts`): a real on-disk capability store, a real
   `ApprovalTokenMinter` (09's own primitive, reused verbatim), and a real on-disk approval
   ledger. This mirrors phase 09's OWN documented decision (`docs/evidence/phase-09/
   README.md`, "#6 (approval-token cross-process durability)") that the minter is
   legitimately in-process-scoped. **Coordinated follow-up needed in `packages/cli`** (not
   made here): (a) wire `dispatch.ts`'s `trust-review`/`trust-approve`/`trust-revoke` cases to
   `runTrustReviewCommand`/`runTrustApproveCommand`/`runTrustRevokeCommand`; (b) widen
   `CliDependencies` (or inject a second bag alongside it) to carry
   `TrustCommandDependencies`'s `store`/`minter`/`approvalLedger`, since 09's own committed
   `CliDependencies.journal` is `Pick<JournalStore, "queryEntries" | "verifyJournal">` only
   (no `appendEntry`) — this phase's own `TrustCommandDependencies`
   (`src/trust/dependencies.ts`) is therefore a distinct, structurally-compatible bag, not a
   reuse of 09's, documented in that file's own doc comment.
3. **Stage 5 (sandbox_test) is a documented spike, not a real OS-level sandbox.**
   `@anthropic-ai/sandbox-runtime` (roadmap/12 §In scope) is **not present in this repo's root
   lockfile** — adding it would be a new external dependency this task is barred from
   introducing unilaterally. **Flagged for the orchestrator: add `@anthropic-ai/
   sandbox-runtime` to the root lockfile/workspace when a real stage-5 harness is built.**
   `src/quarantine/sandbox/types.ts`'s `SandboxRunner` port + `fake-sandbox-runner.ts`'s
   in-process policy evaluator stand in for it today — genuinely proves the POLICY logic
   (network egress denied under `allowedDomains: []`, `~/.ssh` read denied) but never spawns
   a real process/container and provides no actual OS-level security boundary, exactly as
   roadmap/12's own §Risks anticipates ("treat the exact stage-5 harness as a phase-12-local
   spike before trusting it as a security boundary"). A real implementation swaps in behind
   the same `SandboxRunner` interface with no caller-visible change.
4. **Scanners (`secret-scanner.ts`, `script-scanner.ts`, `permission-scanner.ts`) are
   regex/heuristic-based, not real gitleaks/osv-scanner/Syft binaries.** roadmap/12 §In scope
   names these as pluggable scanners bootstrapped through this same quarantine pipeline with
   vendored first-trust digests — no such pinned binary exists in this repo's lockfile today.
   **Flagged for the orchestrator** as a deferred external-dependency addition; the
   `Scanner` interface (`src/quarantine/scanners/types.ts`) is stable and pluggable, so a real
   gitleaks-backed scanner can be swapped into `DEFAULT_SCANNERS` later with no interface
   change. SBOM (Syft) integration is not implemented at all — no fixture/test exercises it;
   `CandidateProvenance.sbomRef` is carried as an opaque, evidence-only string per roadmap/12's
   own "stored as evidence, not proof of benignity" framing, with no producer wired up.
5. **`AuditReport.decision`/`CapabilityManifestEntry.decision` reuses 02's `CapabilityDecision`
   type verbatim** (not redefined) — no deviation, noted for downstream clarity.
6. **The `JournalEntryType` gap roadmap/12 itself flags is NOT resolved here** (out of this
   phase's authority per its own §Risks: "adding a union member is outside this phase's
   authority"). `approval_token_mint` is the only journal entry type this phase's code path
   touches (via 09's `ApprovalTokenMinter`, when constructed with a journal); a capability
   audit pass/fail/contradiction decision is recorded only in the capability-store's own
   `report.json` artifact, exactly as roadmap/12's own text anticipates.

## Carry-forward gaps for the orchestrator

Explicit carry-forwards (NOT fixed as part of this build — flagged for a coordinated
follow-up, per adversarial-review guidance):

**(a) `trust review|approve|revoke` is only met in-process.** The exit criterion is satisfied
against the real backend chain (`src/trust/trust-commands.test.ts`: real on-disk capability
store, real `ApprovalTokenMinter`, real on-disk approval ledger) but it is NOT wired into
`packages/cli/src/commands/dispatch.ts`'s `trust-review`/`trust-approve`/`trust-revoke` cases,
and is NOT tested against a real `packages/supervisor` UDS process. Needs a coordinated
cross-package `packages/cli` + `packages/supervisor` follow-up (see deviation 2 above for the
exact wiring points: `dispatch.ts` cases + widening `CliDependencies` or injecting
`TrustCommandDependencies` alongside it).

**(b) `capability.audit`/`capability.approve` are reachable only via `tools/list`, not a real
`tools/call` dispatch.** `registerCapabilityTools` makes both tools genuinely visible over
real stdio `tools/list` (`src/mcp/tool-definitions.test.ts`, against 09's own
`createToolRegistry`/`startGatewayMcpServer`), and `runCapabilityAudit`/`runCapabilityApprove`
are fully implemented and tested as plain functions — but 09's `gateway-mcp/stdio-server.ts`
has not yet implemented a `tools/call` handler at all (only `initialize`/`tools/list`), so
there is no real dispatch path from an actual MCP tool CALL to these handlers today. Needs 09
to implement `tools/call` dispatch, then a small wiring commit here (or in `packages/cli`) to
register these two handlers against it.

**(c) Scanners fail-open for non-seeded threat variants.** `secret-scanner.ts`/
`script-scanner.ts`/`permission-scanner.ts` are regex/heuristic stand-ins (deviation 4), NOT
real gitleaks/osv-scanner/Syft binaries — they reliably catch the exact roadmap/12-named
seeded threats (AWS/GitHub/Anthropic-style keys, `curl|sh`/`/dev/tcp` reverse-shell patterns,
unscoped `Bash(*)`/whole-home read-write) but a trivially-varied non-seeded threat (e.g. a
`postinstall: node ./steal.js` script with no textually-matching reverse-shell pattern at all,
or a secret encoded/obfuscated to dodge the regexes) passes stage 4 with only a `medium`
"lifecycle script declared" finding, never blocking. This is a known, accepted limitation of a
regex-based scanner layer — the design is explicitly backstopped by human `trust review`
before any `trust approve` mint (a human sees every `pending` entry's full scan-finding list),
and `AuditReport.decision` is correspondingly a STAND-IN verdict from this scanner layer, not
a guarantee of a real scanner's coverage. Needs the real gitleaks/osv-scanner/Syft bootstrap
(deviation 4) to close this gap, not a bigger regex list.

**(d) Hardening notes — not gaps this task can close alone.** (i) `walkRepoTree`'s
read-after-stat (`../fs/safe-read.ts`'s `readTextBounded`) has an inherent TOCTOU window: a
file could be swapped between the walk's `statSync` and a later detector's own read — accepted
as a known, low-severity limitation of static filesystem analysis in general (not unique to
this package), never a code-execution vector either way. (ii) The no-exec static scan
(`src/spawn-surface-scan.test.ts`) proves the absence of `node:child_process` imports and bare
`spawn`/`exec`/`execFile`/`fork` calls, but does NOT scan for `node:worker_threads`,
`node:vm`, native-addon `dlopen`, or a dynamic `import()` of untrusted, walked file content —
none of those are used anywhere in this package's own source today (verifiable by inspection),
but the static scan itself does not structurally PROVE their absence the way it does for
`child_process`. A stronger conformance suite would extend the scanner's pattern set to cover
these too.

Additional (pre-existing, unrelated to the adversarial-review fixes above):

- Root-lockfile addition of `@anthropic-ai/sandbox-runtime` (deviation 3) and a real
  gitleaks/osv-scanner/Syft bootstrap (deviation 4, also (c) above) — both explicitly out of
  this task's dependency-adding authority.
- Skill-selection (stack → relevant Agent Skills, `disable-model-invocation` for rarely-used
  ones) is named in-scope by roadmap/12's own text but has no runtime wiring point pinned by
  any phase yet (roadmap/12 §Risks: "the runtime wiring point is unspecified pending
  10/11") — not implemented here; no test claims otherwise.
