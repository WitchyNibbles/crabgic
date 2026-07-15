# Phase 05 — Supervisor daemon & UDS control plane

| | |
|---|---|
| **Depends on** | 03, 04 — this phase spawns via 03's `EngineAdapter` interface and `packages/testkit`'s fake engine for its own pre-06 worker-lifecycle tests (formerly an informal, unedged reliance; see Risks) |
| **Unlocks** | 06, 09, 16 |
| **Sources** | original plan "Manager and isolated workers" + resource budgets; adaptation §3.1 (hooks/`canUseTool` as the enforcement layer this phase's adjudication stub answers), §4.5 (`session_id` durability, crash/resume), §5.1 layer 0 (per-worker process confinement), §5.6 (crash recovery + plan-limit parking machinery) |
| **Primary package** | `packages/supervisor` |

## Goal

The single-writer orchestration process every later phase talks to instead of touching state directly. It owns the runs/change-sets/work-units/workers/artifact-index registries and exposes them over a UDS control plane — socket `0600` inside a `0700` runtime dir, `SO_PEERCRED`-checked, versioned — trusted by exactly two local peers sharing the invoking uid: the CLI (09), and the gateway (16), which forwards its own `run.status`/`run.cancel` MCP tools over the identical protocol. It manages worker processes through EngineAdapter (03's interface; its fake engine stands in until 06 lands the real one) with per-worker `HOME`/`TMP`/`CLAUDE_CONFIG_DIR` provisioning, a bounded SIGTERM → grace → SIGKILL termination ladder, and startup orphan reaping. Every externally visible effect — a run transition, a work-unit attempt, a session assignment, a tool-call adjudication — is journaled through 04 before it takes effect, and a crash at any point recovers cleanly from that same journal. It streams worker logs through a backpressured ring buffer a slow subscriber can never turn into a stalled worker, and holds its own idle footprint to a fixed, CI-measured budget so running it costs nothing when there is no work. Before this phase, 04 durably stores state but nothing owns a process, a socket, or a worker; after it, 06 has a real spawn target, 09 has a live protocol to speak, and 16 has a second, already-trusted transport for the two run-level operations it forwards — none of the three reinvent a control plane of their own.

## In scope

- **Lifecycle:** started on demand by the CLI (09); exactly one live instance per project, enforced by 04's PID/start-time-validated lease (not a second locking scheme); clean shutdown drains workers before exit; a crash at any point is always recoverable via 04's `recover(runId)` (latest snapshot + journal replay).
- **UDS control plane:** ndjson request/response plus server-push events; socket `0600` inside a `0700` runtime dir; `SO_PEERCRED` uid check as the trust boundary; versioned handshake rejects a mismatched protocol version before serving a request. The boundary admits any local process running as the invoking uid — which is exactly how two logically distinct callers reach it: the CLI (09) directly, and the gateway (16) forwarding its MCP-visible `run.status`/`run.cancel` over the same socket. One handler set, two transports, never a second implementation of either operation.
- **Router surface:** carries every supervisor-owned operation family the CLI and the gateway need, not a narrow fixed triple — `run.status`/`run.cancel`; the registry reads backing 09's `status`/`evidence`/`resume`; and internal `worker.*` administration. `run.*` itself is UDS-only: it is never registered as an MCP tool by this package, under any name — the MCP-visible `run.status`/`run.cancel` tools are 16's forwards, implemented once, here.
- **Registries:** runs, change sets, work units, workers (carrying the engine `session_id`), artifact index. The change-set registry is populated by 11 and read back by 11's own `project.inspect` over this same UDS surface — there is no `change_set.*` MCP tool family anywhere in v1; ChangeSet-state queries are answered exclusively that way.
- **Worker management:** spawn via EngineAdapter (03's interface; `packages/testkit`'s fake engine stands in until 06 lands the real adapter); per-worker `HOME`/`TMP`/`CLAUDE_CONFIG_DIR` provisioning, which 06 later points its SDK `env`/`cwd` at directly; SIGTERM → grace → SIGKILL ladder; orphan reaping at startup.
- **Adjudication stub:** the journal-teed bus every tool call is routed through for a decision before it takes effect (`adjudication_decision` journaled first). This phase's own stub policy — 03 defines the `AdjudicationCallback` call shape it answers — resolves any bridge failure (crash, timeout) to deny; 06 replaces the stub's *policy* with the real journal-first allow/deny/`updatedInput` decision, the bus and its fail-closed default do not change underneath it.
- **Log streaming:** 1 MiB ring buffer per worker; backpressured subscribers — a slow consumer never blocks the worker's own pipe; drops are counted, never silent.
- **Event bus:** journal-tee'd — externally visible effects are journaled (via 04's `appendEntry`) before they take effect. Every entry this phase writes is typed against `JournalEntryType` (02): `run_transition`, `work_unit_transition`, `session_assignment`, `adjudication_decision` are the members this phase triggers; the other nine belong to other phases sharing the same codec.
- **Runtime/state location:** the UDS socket, its `0700` runtime dir, and the registries nest under 04's pinned `$XDG_STATE_HOME/engineering-orchestrator/<project-hash>/` root as a sibling subpath alongside 04's own `journal/` and `leases/` — never a second, parallel root, matching the convention 07's `git-control/` and 12's `capability-store/` already follow under 04's `$XDG_CACHE_HOME` sibling.
- **Idle resource budget:** <100 MiB RSS, <1% of one core, 5 s heartbeats; measured in CI with headroom — this phase's own self-contained probe of its own process (see Out of scope and Risks for why this is not a `packages/perf` benchmark).

## Out of scope

- The `EngineAdapter` interface, `AdjudicationCallback` call shape, `WorkerSdkOptions`, and the fake engine's own packages (`packages/engine-core`, `packages/testkit`) — 03; this phase spawns against the interface and stubs the callback's *answer*, it never defines either.
- The real adjudication policy (journal-first allow/deny/`updatedInput` against the compiled envelope) — 06; this phase's stub only guarantees fail-closed-on-bridge-failure until 06 replaces the policy.
- Envelope→permission/sandbox compilation — 03; this phase passes whatever 03/06 hand it to the spawn call and never compiles a profile itself.
- Journal encoding, hash chain, snapshot format, idempotency registry, lease-file mechanics — 04; this phase calls 04's exported surface (`appendEntry`, `recover`, `recordAttempt`, `Lease`) and never re-implements append/fsync/chain-verify/lease-file logic.
- DAG readiness/dispatch ordering, `TaskPacket` construction, model routing, and the limit-parking *decision* (as opposed to persisting the attempt record itself) — 13; this phase invokes EngineAdapter's `spawn`/`resume` when told to and records the outcome, it never decides *when* or *why* to dispatch.
- Stop-condition detection logic and approval-token mint/verify content — 11/09; 11's detectors drive an existing 02 run-lifecycle transition inside this phase's own registry (see Interfaces produced), but the detection logic and the token content are theirs, not built here.
- CLI argument parsing, doctor checks, terminal UX — 09; this phase is a UDS server, never a client-facing surface of its own.
- Quality/security/performance gate execution and `EvidenceRecord` content — 14/15; this phase persists the `succeeded`/`failed` attempt status those gate verdicts drive, it never scores a gate itself.
- The gateway's own tool implementations (`tracker.*`, `observability.*`, `evidence.get`, `evidence.attach`, `result.submit`) and its transport/secrets/mutation pipeline — 16; this phase answers only the `run.status`/`run.cancel` operations 16 forwards, nothing about providers.
- The twin-worktree A/B benchmarking harness and any `PerformanceContract` logic — 15 (`packages/perf`); this phase's idle-budget probe is a separate, self-contained measurement of its own process, not a `packages/perf` benchmark (an open tension with how this rewrite's own brief phrased it — see Risks).

## Interfaces produced

- **UDS control-plane protocol** — ndjson request/response + server-push events over a socket `0600` inside a `0700` runtime dir; `SO_PEERCRED` uid check; versioned handshake. Consumed by 09 ("this phase's typed client speaks this protocol," 09's own text) and by 16, whose forwarded `run.status`/`run.cancel` MCP tools speak the identical protocol.
- **Two trusted UDS clients, one router:** the CLI (09) and the gateway (16) are both local processes running as the invoking uid, so both clear the same `SO_PEERCRED` check and dispatch through the same handlers — 16's forwarding is a second transport onto this phase's existing `run.status`/`run.cancel` handlers, never a second implementation. `run.*` is UDS-only and is never itself an MCP tool family; the MCP-visible names belong entirely to 16's forwarding layer.
- **Contract-typed router**, covering every supervisor-owned operation family the CLI and the gateway need: `run.status`, `run.cancel` (the exact names 09 calls directly and 16 forwards), registry reads backing 09's `status`/`evidence`/`resume`, and internal `worker.*` administration. This combination — spawn/reap, the log ring buffer, and this request-response surface — is what 13 names as "worker lifecycle plumbing... invoked through 06, never reimplemented" in its own scope.
- **Registries:** runs, change sets, work units, workers (carrying engine `session_id`), artifact index. Consumed by 09 (`status`/`evidence`/`resume` read through these) and by 11's `project.inspect`, which answers ChangeSet-state queries by reading the change-set registry over this same UDS surface — no `change_set.*` MCP tool family exists; this is the only external read path for ChangeSet state.
- **Run-lifecycle transition surface** hosted on the run registry: this phase transitions it directly on the paths it owns (start/crash/shutdown), and exposes the identical mechanism for 11's stop-condition detectors and, later, 13's dispatch loop to drive existing 02 run-lifecycle transitions from inside `packages/supervisor` — no second transition table, no new state-machine states. No new dependency edge is needed for 11 to do this (it already depends on this phase transitively via 06 and 09), the same registry-aggregation convention already used for the gateway's own tool registry.
- **Worker lifecycle mechanics:** spawn/reap via EngineAdapter, per-worker `HOME`/`TMP`/`CLAUDE_CONFIG_DIR` provisioning, the SIGTERM → grace → SIGKILL ladder, and startup orphan reaping. 06 points its SDK `env`/`cwd` at exactly what this phase provisions, without this phase's own code changing.
- **`AdjudicationCallback` stub + journal-teed event bus:** every tool call is routed through this bus for a pre-effect decision, journaled first (`adjudication_decision`). A bridge failure always resolves to deny. 06 replaces the stub's *policy* with the real journal-first implementation; the bus and its fail-closed default are unchanged by that replacement.
- **Crash-detection → journaled-attempt-record → recovery-hook slot:** a worker crash is detected, an attempt record is journaled, and a recovery hook fires — resume/fork policy lands in 06/13; this phase supplies the detection, the record, and the hook's call site, never the policy answering it.
- **Journal writes this phase triggers**, typed against `JournalEntryType` (02) and appended via 04's `appendEntry`: `run_transition` (run-lifecycle moves), `work_unit_transition` (attempt-status changes, including the `parked:rate_limit` continuations 13 later drives through this same mechanism), `session_assignment` (engine `session_id` journaled before a worker process starts), `adjudication_decision` (every tool-call verdict). This phase decides *when* each is written; 04 owns only the codec.
- **Idle resource budget:** <100 MiB RSS, <1% of one core, 5 s heartbeats, measured in CI with headroom — this phase's own exit criterion, re-measured unchanged as a release gate by 23.
- **`docs/ipc-protocol.md`** — the UDS wire-protocol reference, additive-only within a major version; the document 09's typed client and 16's forwarding path are both written against.

## Interfaces consumed

From **04** (`packages/journal`), this phase's sole direct dependency:
- `appendEntry(entry: JournalEntryInput)` — the write path for every entry this phase journals (`run_transition`, `work_unit_transition`, `session_assignment`, `adjudication_decision`).
- `writeSnapshot(snapshot: RunSnapshot)` / `loadLatestSnapshot(runId)` / `recover(runId): { snapshot, replayed }` — "consumed by 05 on supervisor restart" (04's own text); this phase's crash-recovery path is this call, not a bespoke replay loop.
- `recordAttempt(workUnitId, sessionId, status: WorkUnitAttemptStatus)` — "consumed by 05 (worker lifecycle)" (04's own text); every dispatched/succeeded/failed/parked transition this phase records goes through it.
- `Lease.acquire(projectHash)` / `#renew()` / `#release()` — "consumed by 05 (one supervisor per project)" (04's own text); backs this phase's single-instance-per-project guarantee.
- `runKillHarness(operation, faultPoints[])` — reused directly for this phase's own crash-recovery test suite (04's own text: "reusable by 05/13/23's own crash-recovery tests").
- On-disk layout constants: `$XDG_STATE_HOME/engineering-orchestrator/<project-hash>/journal/`, `.../leases/` — this phase's own runtime dir/registries nest as a sibling subpath under the same pinned root, never a second root.

From **03** (`packages/engine-core`, `packages/testkit`) — direct dependency (`P03 --> P05`; formerly informal, pre-06, no dependency edge — see Risks):
- `EngineAdapter`'s interface shape and the fake-engine implementation this phase spawns against for its own worker-lifecycle tests until 06 lands the real adapter; `AdjudicationCallback`'s call shape, which this phase's stub answers.

**Ambient, via `packages/contracts` (02)** — not a direct Depends-on edge, the same convention every phase applies:
- `JournalEntryType` (13-member closed union) — the discriminant this phase's journal writes are typed against.
- `WorkUnitAttemptStatus` (`pending | dispatched | succeeded | failed | cancelled | parked:rate_limit`) — the type this phase's attempt records carry.
- Run-lifecycle enum (`draft … published_local`, terminals `failed|blocked|cancelled`) — the type this phase's run registry transitions against, validated by 02's own transition-table function before this phase ever calls `appendEntry`.
- `RunSnapshot`, `WorkUnit` (incl. `session_id`), `ChangeSet` schemas — the shapes this phase's registries persist and round-trip.

## Work items

1. Runtime dir/socket + permission tests; protocol codec + versioned handshake; wire the runtime dir as a sibling subpath under 04's pinned `$XDG_STATE_HOME` root, never a second root. Failing-first: a socket created with default permissions fails a `0600`/`0700` assertion before the hardened creation path exists.
2. Contract-typed router carrying every supervisor-owned operation family (`run.status`, `run.cancel`, registry reads, internal `worker.*`) + `SO_PEERCRED` peer-auth middleware admitting any same-uid caller — the CLI (09) directly, the gateway (16) forwarding later. `run.*` stays UDS-only; no MCP tool is registered by this package. Failing-first: a foreign-uid connection attempt must be refused before the peer-auth middleware exists.
3. Registries: runs, change sets (11 populates; 11's `project.inspect` is the sole external reader — no `change_set.*` tool grows here), work units, workers (incl. `session_id`), artifact index; recovery wired against 04's `recover(runId)`. Failing-first: a query against an empty registry returns empty, not a throw, before the registry backing store exists.
4. Worker lifecycle vs. the fake engine (03/`packages/testkit`) incl. crash detection → journaled attempt record → recovery hook (resume/fork policy lands in 06/13); per-worker `HOME`/`TMP`/`CLAUDE_CONFIG_DIR` provisioning; SIGTERM → grace → SIGKILL ladder; orphan reaping at startup. Failing-first: a killed fake worker stays unreaped against a stub lifecycle manager before the ladder/reaper exists.
5. Ring buffer + subscriptions + drop accounting. Failing-first: a slow-subscriber fixture stalls the worker pipe against a naive unbounded queue before the backpressured buffer replaces it.
6. Idle perf test + heartbeat scheduler — a self-contained `/proc`/`getrusage`-style probe of this process alone, not a `packages/perf` benchmark. Failing-first: an idle-window measurement exceeds the RSS/CPU budget against a naive always-polling implementation before the heartbeat-paced version replaces it.
7. `docs/ipc-protocol.md` (additive-only within a major version).

## Test plan

**Unit:** protocol codec encode/decode round-trip (ndjson framing, handshake version negotiation); socket/runtime-dir permission checks (`0600`/`0700`); ring-buffer capacity/eviction math; `SO_PEERCRED` uid-extraction parsing.

**Property (fast-check):** randomized concurrent-subscriber sequences — a slow subscriber's drops are always counted and never propagate backpressure to the worker pipe; randomized peer-uid sequences — only the invoking uid's own processes are ever admitted, foreign uids refused regardless of arrival order.

**Integration:** failing-first, over a real UDS socket in tmp dirs (no mocked transport) — handshake against version skew; router dispatch for `run.status`/`run.cancel`/`worker.*`; fake-engine fault injection (hang, crash, log-spam) proving the SIGTERM → grace → SIGKILL ladder and orphan reaping; two concurrent same-uid connections (standing in for the CLI and the gateway) both clearing `SO_PEERCRED` against the identical router; kill -9 mid-operation → restart → registries recovered via 04's `recover(runId)` with no duplicated side effect; idle-heartbeat measurement over a sustained no-op window against the documented RSS/CPU numbers.

**Conformance:** `docs/ipc-protocol.md` — a wire-format change lacking a version bump fails a schema-diff check (additive-only within a major).

**Security:** foreign-uid peer refused before any request is served; a crashed/timed-out adjudication bridge resolves to deny, never allow (the property 06's real implementation must also uphold); idle-budget measurement captures no environment/secret content.

## Exit criteria

- [ ] Foreign-uid peer refused (unit-tested check; integration where CI permits).
- [ ] Two same-uid local connections (standing in for the CLI and the gateway) both pass the `SO_PEERCRED` check against the identical router and receive identical `run.status`/`run.cancel` responses — proving one handler, two transports.
- [ ] kill -9 mid-operation → restart recovers registries via 04's `recover(runId)`; no duplicated side effects.
- [ ] Hung fake worker fully reaped within deadline — evidence: Test plan's Integration suite, fake-engine fault injection (hang/crash/log-spam) proving the SIGTERM → grace → SIGKILL ladder and orphan reaping.
- [ ] Slow subscriber never stalls a worker; drops surfaced — evidence: Test plan's Property (fast-check) suite, randomized concurrent-subscriber sequences asserting drops are always counted and never propagate backpressure to the worker pipe.
- [ ] Idle budget test green with documented numbers (<100 MiB RSS, <1% of one core, 5 s heartbeat).
- [ ] A repo-wide check confirms no `change_set.*`-named operation exists anywhere in this package's router or registry surface.

## Risks & open questions

- **Resolved — the 03/05 dependency-edge gap:** this phase's own worker-management scope ("spawn via EngineAdapter (fake engine until 06)") needs 03's `packages/engine-core` interface and `packages/testkit`'s fake engine at this phase's own build time, for its own pre-06 worker-lifecycle tests. This is now reflected: this phase's header lists `03, 04` under Depends on, and the README's dependency graph carries a `P03 --> P05` edge.
- **Flagged, not resolved here — the idle-budget/`packages/perf` tension:** this rewrite's own brief characterizes 23's idle-budget re-measurement as `packages/perf` (15) owning the harness. 15's own file states the opposite, twice, by name: the supervisor idle-resource budget is "owned end-to-end by 05 ... and re-measured directly by 23; not a PerformanceContract, never routed through `packages/perf`," and its resource-capture wrappers apply "around the benchmarked base/candidate processes only (not the supervisor's own idle budget — see Out of scope)." This file follows 15's explicit, twice-stated text: the idle-budget probe is this phase's own self-contained measurement, not a `packages/perf` benchmark. Flagging the discrepancy rather than silently picking a side; if 15 is ever revised to actually take this measurement over, this phase's own perf-harness work item and exit criterion need a matching edit.
- Stay dependency-light: 01 names this phase's idle-budget perf harness directly as its reason later phases should bias away from heavyweight frameworks when choosing dependencies — a note this phase's own implementation should honor first, not just later phases'.
- The idle budget is re-measured as a release gate (23) on a quiet host — noisy shared CI should not be the only evidence for the documented numbers.
- WSL2 caveat inherited from 04: if the pinned state root ever resolves onto a `/mnt/c` 9p mount, fsync/lease semantics degrade; `doctor` (09) warns on it, this phase does not special-case it.
- No Claude Code engine fact is asserted directly by this phase — the `AdjudicationCallback` stub's call shape is 03's, envelope/sandbox compilation is 03/06's; this phase's own surface (UDS, registries, ring buffer, lifecycle) is engine-agnostic plumbing, matching 04's identical posture.
