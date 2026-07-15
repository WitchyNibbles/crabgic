# Phase 15 — PerformanceContract & benchmarking harness

| | |
|---|---|
| **Depends on** | 13, 14 |
| **Unlocks** | 23 |
| **Sources** | original plan performance sections (budgets, thresholds, noise rules); adaptation §8 (performance contracts unchanged as planned), §4.2 (sandbox network defaults), §5.7 (dispatch budget/turn semantics) |
| **Primary package** | `packages/perf` |

## Goal

Before this phase, `final_verifying` has no performance-regression gate and 11's approval render has nothing real behind its "provisional perf budgets" line. After this phase, every ChangeSet's integrated candidate is scored by a reproducible, interleaved A/B benchmark against its frozen base revision, and 14's gate framework blocks, passes, or inconclusively-blocks it on a statistically defensible, hash-tamper-evident PerformanceContract verdict.

## In scope

- **Risk detection** — heuristics over diff paths + StackEvidence (12, reaching this phase via 14's direct dependency on 12):
  - Categories: CPU, allocation, copying, I/O, networking, database, serialization, concurrency, caching, dataset-size, user-visible hot paths.
  - Runs at each work unit's `verifying` stage as a lightweight risk tag, not a full benchmark — the full A/B run happens once, later (see Gate registration).
- **Budget sourcing** — in order, first source that resolves wins:
  1. The ChangeSet's IntentContract `performance` section / Requirement acceptance criteria (11, resolved via the requirement IDs a benchmark TaskPacket carries, 13).
  2. Else ecosystem research.
  3. Else the base-revision benchmark run sets the budget itself.
  - The enforced figure must hash-match the provisional one 11's approval render already committed to (via ChangeSet, 02); a mismatch fails closed rather than silently re-sourcing.
- **Methodology:**
  - Framework-appropriate warmup; ≥10 interleaved repetitions (A/B alternating base/candidate, never concurrent).
  - Two worktrees — the integrated candidate's own worktree plus a base-revision worktree, both provisioned through 13's executor (13's own dependency on 07; this phase never calls `packages/git-engine` directly).
  - Measured where applicable: latency percentiles, throughput, error rate, CPU time, peak RSS/heap, allocations, fs/network ops+bytes, query counts, capacity.
- **Decision rules:**
  - Absolute-budget breach blocks.
  - Without an absolute SLO: block statistically supported regressions beyond max(noise bound, 5% for critical-path / 10% for sensitive-path changes).
  - Critical-path noise >15% = inconclusive **and blocking** — a hard stop requiring re-invocation on a quieter host, deliberately *not* routed through 14's flake-quarantine mechanism (a noisy perf verdict must never silently start passing).
- **Resource capture:** `/proc` + `getrusage` wrappers around the benchmarked base/candidate processes only (not the supervisor's own idle budget — see Out of scope); raw samples archived; summaries recorded into EvidenceRecord.
- **Adapters:** generic command benchmark (any `ProjectProfile`-declared benchmark command, mirroring 14's own stack-native test-execution pattern) + a purpose-built Node harness; documented extension point for further stacks.
- **Gate registration:** the full A/B decision runs once, at `final_verifying`, against the exact integrated object ID (mirroring 14's own final-candidate orchestration) — registered into 14's gate registry under the IntentContract's existing `performance` section tag; never a per-work-unit full benchmark.

## Out of scope

- **Supervisor idle-resource budget** (idle RSS/CPU heartbeat SLO) — owned end-to-end by 05 (its own perf-harness work item + exit criterion) and re-measured directly by 23; not a PerformanceContract, never routed through `packages/perf`.
- **Benchmark dispatch, worktree creation, worker sandboxing** — 13 (DAG executor, worktree/session provisioning via its own 07/06 dependencies); this phase supplies methodology and decision logic only, and never spawns a worker or calls `packages/git-engine` itself.
- **The generic gate framework** (risk-tag selection, EvidenceRecord schema, `verifying`/`final_verifying` stage wiring) — 14 (`packages/gates`); this phase is one registered gate, not the framework.
- **IntentContract/Requirement authoring, approval-envelope rendering** — 11; this phase reads the approved `performance` section and never authors requirements or renders the approval UI.
- **StackEvidence/ProjectProfile detection** — 12; this phase only consumes.
- **TDD, coverage, and security checks** (SAST, secrets, dependency/license, flake policy) — 14's own risk tags, not performance's.
- **Disposable live environments and release-candidate orchestration** — 23; this phase supplies the fixture matrix and the contract-satisfaction check 23 gates on.

## Interfaces produced

- **`packages/perf`** — sole implementation host for performance-contract logic; nothing else in the roadmap implements it. Exports:
  - Risk detector + PerformanceContract builder.
  - Twin-worktree A/B runner.
  - Stats/decision engine.
  - `/proc` + `getrusage` measurement wrappers.
  - Adapters (generic command, Node harness) behind a documented extension point.
- **Performance gate handler** — registered into 14's risk-tag-keyed gate registry under the IntentContract's `performance` tag, firing at `final_verifying`.
  - Emits standard EvidenceRecord instances (02 schema: command, exit status, env/toolchain fingerprint, timestamp, artifact digests, exact object ID).
  - Outcome is one of `pass` / `block` / `inconclusive-blocking`.
- **PerformanceContract instances, enforced variant** (02 schema) — this phase builds the measurement-backed, hash-linked instance at gate time and attaches it to the ChangeSet (02 schema; 11 creates) alongside the provisional figure 11 already populated at approval time; this phase never edits or re-derives 11's provisional figure, only hash-checks against it (see Budget sourcing).
- **`perf-conformance` fixture matrix** — a named, standalone-runnable CI job:
  - Covers 20%-CPU-regression-blocks, 3%-noise-passes, noisy-critical-inconclusive-blocking, and methodology-violation-refusal (too-few-reps, no-interleave).
  - This is the exact artifact 23's "Quality/security/perf/learning: seeded-fault matrices from 14/15/22" bullet re-invokes.
- **Archived raw resource-capture samples** — EvidenceRecord artifact digests; the sole substrate for the "verdicts reproducible from archived samples alone" exit criterion (23 can re-derive a verdict without re-running the benchmark).

## Interfaces consumed

- **02 (ambient schema import — same convention every phase uses):** `PerformanceContract`, `EvidenceRecord`, `ChangeSet`, `Requirement` (`performance`-section acceptance criteria) schemas.
- **13 (`packages/scheduler`):**
  - TaskPacket dispatch (exact base object ID, requirement IDs, resource limits, gates) for the benchmark run.
  - The DAG executor's worktree/session provisioning (13's own 07/06 dependencies) — this phase never reaches past 13 to call `packages/git-engine` or spawn a worker directly.
  - Model routing — benchmark dispatch fits the existing "haiku chores" default (13, adaptation §0); no new role introduced.
  - The content-hash cache's `verified results` category — base-revision measurements are cache candidates keyed on base object ID + toolchain fingerprint (optional; avoids re-measuring an unchanged baseline across change sets).
- **14 (`packages/gates`):**
  - The risk-tag-keyed gate framework as an extensible registry — the same aggregation pattern as the gateway's tool registry (resolved Gap 1): 14 exposes the registry, and this phase — already a dependent of 14 — registers into it, no new dependency edge required.
  - `verifying`/`final_verifying` stage hooks and the EvidenceRecord emission shape.
  - Explicitly **not** consumed: 14's flake-quarantine path (see Decision rules) — a noisy perf verdict blocks, it is never quarantined-as-passing.
- **12 (`packages/detect`, transitively — 14 depends on 12 directly, this phase depends on 14):** StackEvidence — risk-detection heuristics and adapter selection key off it.
- **11 (`packages/supervisor`/`plugin`/`cli`, transitively — 13 depends on 11 directly, this phase depends on 13):** the approved PerformanceContract's provisional figure and envelope hash, embedded in ChangeSet (11 creates); the enforced budget must hash-match it or fail closed. 11 itself is unaffected by this phase's build order — it ships and renders its "provisional perf budgets" line independently of when this phase lands.

## Work items

1. Risk detector + PerformanceContract builder — budget-sourcing order (Requirement/IntentContract `performance` section → ecosystem research → base-revision fallback).
   - Failing-first: synthetic diffs tagged with expected risk categories against StackEvidence fixtures.
2. Measurement wrappers (`/proc` + `getrusage`) + artifact schema.
   - Failing-first: wrapper unit tests against a synthetic workload with known resource consumption, plus a secret-leakage negative test (no env/argv capture).
3. Adapters: generic command benchmark (`ProjectProfile`-declared) + Node harness; documented extension point.
   - Failing-first: one conformance fixture per adapter type.
4. Twin-worktree A/B runner — dispatches through 13's executor into per-attempt worktrees/sandbox profiles; warmup + ≥10 interleaved repetitions.
   - Failing-first: fake-engine E2E with a scripted, deterministic benchmark command proving exact interleaving order before any real stack adapter exists.
5. Stats module (bootstrap-CI noise bound, documented method) + decision engine (absolute-budget / 5%–10% statistical / >15% critical-noise inconclusive-blocking).
   - Failing-first: synthetic distributions with known injected regression/noise.
6. Gate registration into 14's registry at `final_verifying`; envelope/ChangeSet hash-link check; EvidenceRecord emission wired for the `perf-conformance` fixture matrix.
   - Failing-first: a tampered post-approval budget fixture must fail the hash-link check and block.

## Test plan

All of the below start red: no risk detector, decision engine, wrappers, adapters, or hash-link check exist yet.

- **Unit:** stats module against synthetic distributions with known regression/noise percentages; decision-engine boundary tests at exactly 5%, 10%, 15%; measurement-wrapper parsing of `/proc`/`getrusage` fixtures.
- **Property:** fast-check over randomized interleaved sample sequences — verdict classification is order-independent (base/candidate interleaving order never changes the outcome) and monotonic in regression magnitude.
- **Integration:** fake-engine E2E dispatching a scripted deterministic benchmark TaskPacket through 13's executor; twin-worktree runner produces a byte-identical interleaved schedule across two runs (determinism); gate fires at `final_verifying` and emits a schema-valid EvidenceRecord 14's framework can read.
- **Conformance:** the `perf-conformance` fixture matrix itself — 20% CPU regression blocked, 3% noise-level change passes, noisy-critical fixture inconclusive-blocking, methodology violations (too few reps, no interleave) refuse a verdict.
- **Security:** resource-capture artifacts contain no process environment/argv content (secret-leakage vector into evidence); a post-approval budget edit fails the envelope/ChangeSet hash-link check closed rather than silently enforcing the new figure.

## Exit criteria

- [ ] `perf-conformance` fixture matrix green: 20% CPU regression blocked; 3% noise-level change passes; noisy-critical fixture → inconclusive-blocking (CI job).
- [ ] Methodology violations (too few reps, no interleave) refuse to produce a verdict (unit test).
- [ ] Enforced budgets are hash-linked to the approved envelope; a tampered post-approval edit fails closed (integration test + journal entry).
- [ ] Verdicts reproducible from archived samples alone, byte-identical on re-derivation (determinism test).
- [ ] Performance gate fires through 14's risk-tag-keyed registry at `final_verifying` and emits a schema-valid EvidenceRecord (integration test against 14's gate harness).
- [ ] Resource-capture artifacts contain no environment/argv content (security test).
- [ ] `perf-conformance` runs as a standalone, named CI job invocable without the full release harness — the exact entry point 23 re-runs.

## Risks & open questions

- Shared CI runners are noisy — product release perf runs happen on quiet hosts or are marked inconclusive per policy; a parked-then-resumed benchmark (13's `parked:rate_limit`) spans two host-load regimes and must restart the full interleaved sequence from scratch, never resume mid-sequence.
- The reference worker sandbox profile (adaptation §4.2/Appendix B, implemented by 03's envelope compiler) sets `allowLocalBinding: false`; benchmarking a networking-risk hot path that binds a local port needs an explicit, approval-visible AuthorizationEnvelope grant (11) — never a silent default change. Verify at build time whether this phase's Node-harness adapter ever needs such a grant for realistic fixtures.
- Phase 20 and Phase 21 have already reconciled the connector latency/throughput counters that reach 14's shared EvidenceRecord stream: both explicitly confirm no 20→15 or 21→15 edge exists in the README graph (15 and 21 are sibling dependents of 14; 20 depends on 16/17 only) and that the counters are available to, but not contractually consumed by, 15 — surfacing solely via the shared journal (04)/EvidenceRecord stream. No reconciliation is outstanding here; this phase consumes no such feed.
- No new unconfirmed Claude Code engine facts: dispatch, sandbox, and session routing are entirely inherited from already-resolved 06/13 spikes; the only environment-specific constraint this phase introduces is the confirmed (not unconfirmed) `allowLocalBinding` default above.
