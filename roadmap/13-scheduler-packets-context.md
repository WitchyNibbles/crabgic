# Phase 13 — Scheduler, task packets, caching, limit parking

| | |
|---|---|
| **Depends on** | 06, 07, 11 |
| **Unlocks** | 14, 15, 22 |
| **Sources** | original plan "Specialist scheduling and context efficiency"; adaptation §0 (routing + limit policy), §3.2 (delegation-depth/concurrency enforcement), §4.5 (session/resume durability), §5.6 (parking + crash recovery), §10 risk 9 |
| **Primary package** | `packages/scheduler` |

## Goal

Once this phase lands, the DAG approved in 11 executes to completion without further human intervention: a default-serial, evidence-gated dispatch loop turns each ready WorkUnit into a bounded attempt via 06's EngineAdapter, fans out only when independence is proven (≤4 concurrent, delegation depth 1, rationale journaled), builds minimal TaskPackets, caches content-hash-addressable results, routes models by role under balanced defaults, and survives a subscription rate/usage-limit signal by parking and later resuming the same engine session. Worker lifecycle mechanics (spawn/reap/log streaming/UDS surface) remain 05's, invoked through 06 — this phase is the readiness/ordering/repair policy layered on top, not a second implementation of them.

## In scope

- **DAG executor:** readiness = dependencies + lease + overlap analysis (07) + non-Git resource serialization; default one worker; fan-out only when independence is proven and benefit exceeds coordination cost, rationale journaled (`fanout_rationale`, `JournalEntryType`, 02); concurrency cap 4; worker delegation depth 1 asserted (envelope compiler, 03, already denies `Agent` at spawn time via 06, per adaptation §3.2).
- **Attempt policy:** one initial + two evidence-driven repairs; repeating an unsuccessful action requires new diagnostic evidence (journal-checked) — either the worker's own reported failure (WorkerResult) or a gate verdict surfaced by 14 (built on top of this phase); every attempt transitions through `WorkUnitAttemptStatus` (02) and is journaled as a `work_unit_transition` entry (`JournalEntryType`, 02).
- **Scheduler half of the TDD evidence protocol** (14 work item 2, "scheduler cooperation"): journal a base-revision (red) evidence capture immediately before an attempt is dispatched, and mark the candidate (green) available immediately after a `succeeded` transition. 14's gate framework, built on this phase, keys its own verification stages off these journal points; this phase never itself decides gate pass/fail.
- **TaskPacket builder:** requirement IDs, objective, non-goals, exact base object ID (07's freeze), relevant interfaces, owned paths (11's write ownership), constraints, resource limits, gates, result schema — nothing else; size budgets enforced. Optional ephemeral lesson-preamble slot, populated only by an in-run repair (22: "a repair may use a lesson during the active run") or by shadow-run (below) — never a persistent packet field, never read anywhere else.
- **Artifact store:** raw logs/tests/benchmarks as bounded artifacts, addressed by work-unit/attempt id; manager context gets decisions + compressed evidence only; the benchmark slot is where 15 archives its raw resource-capture samples.
- **Caches:** content-hash keyed (stack profiles, doc research, provider capabilities, verified results), salted by toolchain fingerprint. Stack-profile/doc-research entries arrive pre-computed via 11's drafting flow, which optionally incorporates 12's detection (Gap 9) — this phase never depends on 12 directly. Shadow-run attempts (below) bypass this cache on both read and write.
- **Model routing:** role → alias map (balanced defaults: `sonnet` implementation workers, `opus` architect/planner + integration/security review, `haiku` mechanical chores, adaptation §0); overrides only via the approved envelope; resolved at dispatch time, immediately before the call into 06's spawn surface.
- **Limit parking:** on `limitSignal` (06): park (`WorkUnitAttemptStatus: parked:rate_limit`, session retained — only reachable from, and returning to, `dispatched`) → backoff past reset window → re-dispatch via `resume`; account-wide signals pause globally; parking timers derived from journal (restart-safe); user-visible status; same recovery machinery as crash resume (adaptation §5.6), different trigger.
- **Shadow-run mode** (22 §In scope "Shadow runs:" bullet and work item 4, "Shadow-run comparator registered against 13's mirrored-dispatch primitive; outcome diffing" — name coined here, not a verbatim quote from 22): given an existing WorkUnit and a candidate lesson preamble, executes an isolated mirrored attempt — its own worktree and session, cache-bypassed, no mutation of the primary attempt's journal state beyond a marker entry — and returns the resulting WorkerResult/artifact handle. This phase owns isolated execution only; comparison and grading logic belong to 22.

## Out of scope

- Gate pass/fail evaluation, coverage/security adapters, evidence-emission policy (14) — this phase supplies the journaled dispatch/candidate seam only.
- Benchmark methodology, statistics, decision rules, the twin-worktree A/B runner itself (15) — this phase supplies packet scope (owned paths) and the artifact store's benchmark slot only.
- Lesson grading, contamination detection, promotion/review, persistent-lesson storage (22) — this phase supplies the shadow-run mechanism and the ephemeral preamble slot only.
- IntentContract/DAG/roster/envelope authoring and the human approval gate itself (11) — this phase consumes the approved artifacts and never re-derives or re-approves them.
- Manager-side native subagent exploration (`isolation: worktree`, read-heavy inspection) — that surface belongs to 10/11; this phase is pure supervisor-owned worker-DAG execution, never "manager subagents" (Gap 9's own clarification).
- Worktree creation/destruction/quarantine and the overlap-analysis algorithm itself (07) — this phase only consumes readiness inputs.
- EngineAdapter spawn/resume/cancel implementation, session/hook/sandbox mechanics, structured-output validation (06) — this phase only calls it.
- Worker lifecycle plumbing — spawn/reap/log ring buffer/UDS request-response surface (05) — invoked through 06, never reimplemented here.
- Gateway MCP tools incl. `evidence.attach`/`result.submit` (16) — a worker-facing, mid-run artifact-attachment mechanism, distinct from this phase's supervisor-side artifact store; the relationship between the two is unresolved (see Risks).
- Doc-research task-packet generation (12) — consumed by 11's drafting flow, never directly by this phase (Gap 9).

## Interfaces produced

- **Attempt-lifecycle journaling** (`WorkUnitAttemptStatus`, 02: `dispatched | succeeded | failed | parked:rate_limit`, journaled as `work_unit_transition` entries, `JournalEntryType`, 02) — every dispatch/success/failure/park transition is the seam 14's "TDD evidence protocol with scheduler cooperation" (14 work item 2) keys off: red-at-base captured before `dispatched`, green-at-candidate captured at `succeeded`. Consumed by 14.
- **Fan-out rationale records** (`fanout_rationale`, `JournalEntryType`, 02) — journaled whenever the executor fans out beyond one worker; carries expected token cost. Consumed by 22 (scheduling-lesson evaluation, see Risks) and by 23's release-matrix evidence trail generically.
- **TaskPacket instances** (`TaskPacket`, 02 schema; this phase builds them) — requirement/scope/base-object-id/owned-paths/constraints/gates/result-schema, size-bounded. Consumed by 06 (spawn input) and by 15 (risk-detection heuristics run "over diff paths" — the packet's declared owned paths are that diff scope).
- **Artifact store** — bounded raw logs/tests/benchmarks, addressed by work-unit/attempt id, with a compressed-summary projection for manager context. Consumed by 15 ("raw samples archived" — this is where) and referenced by 14's EvidenceRecord artifact-digest fields.
- **Shadow-run mechanism** (22 §In scope "Shadow runs:" bullet and work item 4, "Shadow-run comparator registered against 13's mirrored-dispatch primitive; outcome diffing") — isolated mirrored-attempt execution (distinct worktree + session, cache-bypassed, no primary-journal mutation beyond a marker entry) returning a WorkerResult/artifact handle. Consumed by 22, which owns all comparison/grading/promotion logic on top of it.
- **Ephemeral lesson-preamble injection point** on the TaskPacket builder — accepts a caller-supplied preamble string for exactly two callers: an in-run repair attempt and the shadow-run mechanism above. Consumed by 22.
- **CLI `resume <run-id>` backend, limit-parked half** — 09 declares the command and stubs it `NOT_IMPLEMENTED`; the session-resume half of the real backend is 06's, the parked-work-unit re-dispatch half is this phase's, matching 09's own established convention for later-wired commands. No new dependency edge — 09 already owns the command surface.
- 23's release-matrix items "dependent serialization," "worker crash," "idempotent resume," and "cancellation" exercise this phase's executor/repair/parking arcs directly; no additional named interface beyond the above is required for that coverage.

## Interfaces consumed

- **From 06** (`packages/engine-claude`): EngineAdapter `spawn`/`resume`/`forkSession`/`cancel` (contract 03, implemented here) — the sole mechanism for turning a ready WorkUnit+TaskPacket into a running attempt, for both crash-recovery and limit-park re-dispatch (same call, different trigger); `limitSignal` events (06's own "Limit signals" bullet) as the park trigger; the typed schema-violation failure on WorkerResult ("schema violation → typed failure feeding the repair-attempt path," 06) as one of two sources of "new diagnostic evidence" for a repair attempt (the other being a gate verdict from 14); balanced-default model aliases (`sonnet`/`opus`/`haiku`) resolved through the same spawn surface's `model` parameter; the per-attempt engine `session_id` (persisted on `WorkUnit`, 02, populated via 06), retained across park/resume.
- **From 07** (`packages/git-engine`): overlap-analysis output (rename-aware path collisions between planned write sets + the declared non-Git resource registry) as the executor's serialization input; worktree lifecycle (create/destroy/quarantine) — each dispatched attempt, primary or shadow, gets a worktree path as its spawn `cwd`; the frozen base object ID (Intake freeze) populating each TaskPacket's base-object-id field.
- **From 11** (`packages/supervisor`/`packages/plugin`/`packages/cli`): the approved IntentContract + decision-complete DAG (WorkUnit graph with dependencies) + roster (role per unit) + write ownership (per-unit owned paths) + integration order + rollback strategy — this phase's sole planning input; dispatch never begins before 11's one-time approval token is verified and the run has moved past `ready` (02); a stop condition raised by 11's state machine mid-run halts dispatch, not just gates its start.
- **From 02** (`packages/contracts` — foundational and available to every later-built phase per the existing cross-phase convention, not listed as a direct header dependency): `WorkUnit`, `TaskPacket`, `WorkerResult`, `RunSnapshot` schemas; the `WorkUnitAttemptStatus` and `JournalEntryType` closed unions this phase writes against; the run-lifecycle enum (dispatch proceeds only while the owning run is `running`).

## Work items

1. Executor + readiness engine (deps/lease/overlap/non-Git resource inputs) + fan-out rationale records (`fanout_rationale`) + attempt-lifecycle journaling (`WorkUnitAttemptStatus` transitions as `work_unit_transition` entries) incl. pre-dispatch base-revision red-evidence capture and post-`succeeded` candidate availability.
2. TaskPacket builder + budget enforcement + golden packets + the ephemeral lesson-preamble slot (used only by item 6 and by in-run repairs).
3. Artifact store + summary-projection helpers, incl. the benchmark-sample slot 15 archives into.
4. Cache layer + fingerprint invalidation; explicit bypass path for shadow-run reads/writes.
5. Router + config schema; parking state machine with journal-derived timers (`parked:rate_limit`).
6. Shadow-run mode: isolated mirrored attempt (dedicated worktree/session, cache-bypassed, marker-only journal footprint) returning a WorkerResult/artifact handle.
7. Fake-engine E2E: 3-unit DAG with forced overlap (two serialize, one proceeds independently), crash mid-attempt (repair), limit signal (parked → resumed across a simulated supervisor restart), shadow-run alongside a live primary (isolation asserted).

## Test plan

Everything below is written red before the corresponding executor/builder/cache/router behavior exists (roadmap TDD ground rule); fake-engine fixtures reuse 03's fixture format.

- **Unit:** readiness computation against hand-built dependency/lease/overlap fixtures; TaskPacket size-budget enforcement (a field exceeding budget blocks dispatch with a diff, never silent truncation); cache-key derivation (content-hash + toolchain fingerprint) equality/inequality vectors; model-router alias resolution incl. override-via-envelope precedence.
- **Property (fast-check):** random DAGs + random overlap sets — overlapping units are never scheduled concurrently; random packet field mutations — any field exceeding budget blocks dispatch; random content/fingerprint pairs — cache hit iff both match exactly, no partial-match false positive.
- **Integration:** 3-unit DAG with forced overlap + independent unit; crash mid-attempt → repair with fresh diagnostic evidence, third attempt without new evidence refused with a typed error; limit-signal → park → simulated clock past reset → resume with the same `session_id`, survives a simulated supervisor restart mid-park; shadow-run of a mirrored attempt alongside a live primary — primary's cache/journal state is provably unaffected.
- **Conformance:** adaptation §9's *Sessions* item, the slice this phase owns — kill -9 mid-attempt → resume continues in the same worktree with this phase's policy choosing resume-vs-fork correctly (the mechanical capability itself is 06's, already covered there); two concurrently-parked work units from the same project never collide on a `session_id`. Adaptation §9's *Structured output* item's tail — a 06-reported schema-violation failure is accepted as valid repair-triggering evidence exactly once per attempt (no double-counting toward the two-repair cap).
- **Security:** packet-builder fuzz — a TaskPacket's owned-paths/commands can never be constructed wider than the approved AuthorizationEnvelope it's derived from (property test over random envelope/packet pairs); shadow-run isolation — a shadow attempt's artifacts and cache writes are never reachable from the primary attempt's read path or any other run's, including under adversarial same-content-hash collisions; cache-poisoning resistance — an entry keyed to one toolchain fingerprint is never served to a dispatch declaring a different one.

## Exit criteria

- [ ] Property test over random DAGs + overlap sets: overlapping units never concurrent (fast-check suite).
- [ ] Third attempt without new evidence refused with a typed error; a 06 schema-violation failure counts as valid evidence exactly once (integration suite).
- [ ] Packet budget violations block dispatch with an actionable diff — no silent truncation (unit suite).
- [ ] Parking E2E completes with the same `session_id`; journal shows the full arc; survives a simulated supervisor restart mid-park.
- [ ] Cache hit path byte-identical to cold path; poisoning/partial-match property tests green.
- [ ] Shadow-run E2E: mirrored attempt runs to completion in isolation; primary attempt's journal/cache/artifacts are provably unmodified (diff-based isolation assertion).
- [ ] Every attempt transition this package records matches a `WorkUnitAttemptStatus` member, and every entry it journals matches a `JournalEntryType` member (exercised here against 02's discriminated-union exhaustiveness harness).

## Risks & open questions

- This phase's parking/resume machinery is the named mitigation for adaptation §10 risk 9 ("subscription-auth workers share plan rate limits... weaken per-worker USD attribution") — that risk entry literally names "pause-and-resume scheduler" as the mitigation, i.e. this phase. Attempt/turn limits are accounted in tokens/turns (`maxTurns`, result `usage`), not USD, per §5.7's budget-semantics shift.
- Fan-out is a cost decision, not just a concurrency one: the rationale record carries expected token cost so 22 can evaluate scheduling lessons later.
- **Open, flagged for the reconciler:** the relationship between this phase's supervisor-side Artifact store and 16's worker-facing `evidence.attach`/`result.submit` MCP tools (Gap 1) is not specified anywhere — plausibly the same underlying store, plausibly two stores with a sync step. Not resolved here since 16 is outside this phase's Depends-on.
- **Open, 02's discretion (Gap 4):** `WorkUnitAttemptStatus`'s full membership beyond `dispatched | succeeded | failed | parked:rate_limit` is unset; this phase's task-level cancellation backend (09's `cancel <run-id|task-id>`) is written against whatever 02 lands on, with `cancelled` as the anticipated member per Gap 4's own text.
- **Verify-at-build-time:** none of adaptation's explicitly-unconfirmed engine facts (§10 items 2/3/10 — `--permission-prompt-tool` schema, SDK `settingSources` default, `MAX_MCP_OUTPUT_TOKENS`) are load-bearing for this phase's own logic; all engine interaction is mediated through 06's already-adapted surface. The one indirect exposure is `limitSignal` shape fidelity — confirmed at phase 00, passed through unchanged by 06; a later revision to that shape would require a matching update to this phase's park-trigger detection, not to its parking policy.
