# Phase 04 — Event journal, snapshots, idempotency, leases

| | |
|---|---|
| **Depends on** | 02 |
| **Unlocks** | 05, 07, 16 (direct); 23 transitively (via 05/07/16 — see Interfaces produced, "imported directly by 05, 07, 16 ... transitively by ... 23") |
| **Sources** | original plan "Durable execution"; adaptation §4.5 (session_id durability), §5.6 (crash recovery, plan-limit parking), §8 (journal/lease/idempotency invariants) |
| **Primary package** | `packages/journal` |

## Goal

When this phase is done, every phase that needs durable state — 05's registries, 07's freeze/quarantine records, 09's evidence reads, 13's fan-out and rate-limit parking, 16's exactly-once mutation pipeline, and 23's release-gate report — writes through one append-only, hash-chained, crash-tested journal instead of inventing its own persistence. Entries are typed against `JournalEntryType` and work-unit attempts against `WorkUnitAttemptStatus` (both 02); a kill -9 at any point in any operation this package owns always recovers to a valid, corruption-free state; identical-content operations replay byte-for-byte instead of re-executing; and exactly one supervisor process holds a project's lease at a time. Before this phase, no subsystem has a durable write path; after it, 05 (and everything behind it) can be built assuming crash-safety, replay-safety, and mutual exclusion are already solved.

## In scope

- **Journal:** append-only ndjson entry log, typed against the closed `JournalEntryType` union (02 — 13 members, listed under Interfaces consumed). This package owns the single append/query codec every phase writes through and reads from — not what triggers a given entry, or which phase decides to write which member (see Out of scope). SHA-256 hash chain (`prevHash`/`hash` per entry); append = write → `fsync(file)` → `fsync(dir)`; segment rotation at a size/age threshold; tail repair on torn writes (truncate to the last valid chained entry, report the truncation as its own entry).
- **Snapshots:** atomic `RunSnapshot` (02 schema) via temp-file + rename; recovery = load the latest snapshot + replay journal entries after its sequence number.
- **Idempotency registry:** keyed `(operationId, contentHash)`. Same id + same hash → returns the previously recorded result byte-identical, no re-execution. Same id + different hash → typed conflict failure, never a silent overwrite. Backs 16's `RemoteOperationRecord` (02) exactly-once pipeline and 08's CAS-ref rebuild loop.
- **Work-unit attempt tracking:** every `WorkUnit` (02) attempt persisted with its engine `session_id` and a status typed against `WorkUnitAttemptStatus` (02: at least `dispatched | succeeded | failed | parked:rate_limit`; full membership at 02's discretion). `parked:rate_limit` retains `session_id` so a later `resume` can continue the same engine conversation.
- **Leases:** per-project lease file, PID + process-start-time validation, 5 s heartbeat, takeover only after expiry **and** start-time mismatch — guards 05's single-supervisor-per-project invariant.
- **Evidence query surface:** a read path over `evidence_pointer` entries, filterable by run/change-set/work-unit ID, returning `EvidenceRecord` (02 schema, content decided by 14). This is the mechanism behind 09's `evidence <change-set-id>` command and 23's release-gate report: 04 durably stores and serves the records, 14 decides what qualifies as evidence.
- **Layout:** `$XDG_STATE_HOME/engineering-orchestrator/<project-hash>/` — state root (existing): `journal/` (segments + snapshots), `leases/`. `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/` — cache root, pinned here as a sibling constant (Gap 14): 07's control clone nests at `.../git-control/`, 12's capability store nests at `.../capability-store/`. 04 pins the shared root; 07/12 own writing under it.
- **Retention:** segment + snapshot GC, conservative defaults — never deletes a segment newer than the latest durable snapshot.
- **Test-support:** a reusable kill/fault-injection harness — spawns the operation under test in a child process, `SIGKILL`s it at parameterized fault points, asserts recovery converges. This is "the phase-04 kill harness" 07's test plan names as reused directly.

## Out of scope

- Defining the `JournalEntryType`, `WorkUnitAttemptStatus`, run-lifecycle, `RunSnapshot`, `WorkUnit`, `EvidenceRecord`, or `RemoteOperationRecord` schemas — owned by 02; 04 types its codec and registry against them, doesn't declare them.
- Deciding *when* to emit a given entry — each owned by the phase performing that action: run/work-unit transitions and session assignment (05), adjudication decisions (05 stub; 06 real policy), remote-operation records (16), evidence pointers (06/08/14/21), git freeze/worktree quarantine (07), CAS-ref updates (08), approval-token minting (09/11), fan-out rationale (13), milestone sync (18/21), learning transitions (22). 04 only provides the durable, typed write path all of them share.
- The UDS control-plane process, worker registries, and run/work-unit routing logic — owned by 05.
- The mutation pipeline (plan → validate → apply → read-back) that calls the idempotency registry — owned by 16; 04 supplies only the `(operationId, contentHash)` primitive.
- Deciding evidence *content* or gate scoring — owned by 14; 04 stores and serves pointers, doesn't interpret them.
- The `doctor` staleness check and `evidence <change-set-id>` CLI surface — owned by 09; 04 supplies the data those commands read.

## Interfaces produced

`packages/journal` is imported directly by 05, 07, 16 (direct dependents in the phase graph) and, once built, transitively by 06, 09, 13, 21, 22, 23 (via 05/07/11/14/16). Exported surface:

- `appendEntry(entry: JournalEntryInput): Promise<JournalEntry>` — typed against `JournalEntryType` (02); assigns `seq`, `prevHash`, `hash`, `schemaVersion`; resolves only after `write → fsync(file) → fsync(dir)` completes.
- `queryEntries(filter: { type?: JournalEntryType; runId?; changeSetId?; workUnitId? }): AsyncIterable<JournalEntry>` — the evidence/traceability read path; `type: "evidence_pointer"` results deserialize as `EvidenceRecord` (02). Consumed by 09 (`evidence <change-set-id>`), 21 (traceability report), 23 (release-gate report).
- `verifyChain(segment)` / tail repair — truncates to the last valid chained entry, returns a structured report.
- `writeSnapshot(snapshot: RunSnapshot)`, `loadLatestSnapshot(runId)`, `recover(runId): { snapshot, replayed }` — consumed by 05 on supervisor restart.
- `IdempotencyRegistry.checkOrRecord(operationId, contentHash, compute)` → `{ status: "replayed" | "recorded" | "conflict", result? }` — consumed by 16 (`RemoteOperationRecord` exactly-once) and 08 (CAS-ref rebuild).
- `recordAttempt(workUnitId, sessionId, status: WorkUnitAttemptStatus)` — consumed by 05 (worker lifecycle) and 13 (limit parking, fan-out).
- `Lease.acquire(projectHash)` / `#renew()` / `#release()` — PID + start-time-validated exclusive project lease; consumed by 05 (one supervisor per project) and 09 (doctor staleness check).
- `runKillHarness(operation, faultPoints[])` — test-only export, reusable fault-injection harness; consumed directly by 07, reusable by 05/13/23's own crash-recovery tests.
- On-disk layout constants: `$XDG_STATE_HOME/engineering-orchestrator/<project-hash>/journal/`, `.../leases/`; `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/` cache root (Gap 14) — single definition site for 07's `git-control/` and 12's `capability-store/` subpaths.
- Journal on-disk format: ndjson, one `JournalEntry` per line, `schemaVersion`-tagged per 02's contract-evolution convention.

## Interfaces consumed

| From | Names consumed | Why 04 needs it |
|---|---|---|
| 02 | `JournalEntryType` — closed union, 13 members (`run_transition, work_unit_transition, adjudication_decision, remote_operation_record, evidence_pointer, session_assignment, git_freeze, worktree_quarantine, cas_ref_update, approval_token_mint, fanout_rationale, milestone_sync, learning_transition`) | The codec's core discriminant — every entry carries exactly one member |
| 02 | `WorkUnitAttemptStatus` — closed union, at least `dispatched \| succeeded \| failed \| parked:rate_limit` (`cancelled` a strong candidate; full membership at 02's discretion) | Attempt records are typed against this, orthogonal to the run-lifecycle enum |
| 02 | Run-lifecycle enum (`draft → awaiting_approval → ready → running → verifying → integrating → final_verifying → published_local`, terminals `failed \| blocked \| cancelled`) | `run_transition` entries carry a `(from, to)` pair typed against this enum; 04 persists the pair — transition legality is validated by 02's own transition-table function before the caller (05) ever calls `appendEntry` |
| 02 | `RunSnapshot` schema | Snapshot writer/loader round-trips this exact shape |
| 02 | `WorkUnit` schema (incl. `session_id`) | Attempt records persist the `session_id` this schema carries |
| 02 | `EvidenceRecord` schema | Evidence query surface deserializes `evidence_pointer` entries into this shape |
| 02 | `RemoteOperationRecord` schema | Idempotency registry keys and stores against this shape for 16 |
| 02 | `ChangeSet` schema (ID field) | Evidence query surface filters by change-set ID |
| 02 | `schemaVersion` convention | Journal entries must survive contract evolution across schema versions — 02's own stated invariant, 04 is the named consumer |

## Work items

1. ndjson entry codec with chain fields, typed against `JournalEntryType` (02); schema-versioned payloads; work-unit attempts typed against `WorkUnitAttemptStatus` (02) — failing-first: a round-trip test for each of the 13 `JournalEntryType` members and each `WorkUnitAttemptStatus` member fails against a stub codec before the real encoder/decoder exists.
2. Append path + fsync discipline (`write → fsync(file) → fsync(dir)`); measure p50 append latency — failing-first: a fault-injected kill between write and fsync fails against a naive buffered writer before the fsync-ordered implementation lands.
3. Chain verifier + tail repair (truncate to last valid chained entry, report the truncation); snapshot writer/loader (temp + rename); `recover(runId)` = load snapshot + replay — failing-first: a corrupted-tail fixture (valid chain truncated mid-entry) fails verification before the repair path exists.
4. Evidence query surface (`queryEntries`, filterable by run/change-set/work-unit ID; `evidence_pointer` deserializes as `EvidenceRecord`) — failing-first: a query-by-change-set-id test fails against a stub supporting only full-segment scans.
5. Idempotency registry: `(operationId, contentHash)` keyed, journal-backed, replayable — failing-first: a same-id-same-hash replay test expects a byte-identical result and fails against a stub that re-executes instead of replaying.
6. Lease module (`O_EXCL` create, PID + start-time validation, 5 s heartbeat) — failing-first: a two-process contention test expects exactly one lease holder and fails against a naive non-atomic create.
7. Crash harness (`runKillHarness`): child killed at randomized, parameterized fault points; recovery must always converge — failing-first: the harness is run against work items 2–5 and must catch at least one seeded corruption class before it is trusted for reuse by 07/05/13/23.

## Test plan

- **Unit:** codec round-trip per `JournalEntryType` member (13) and `WorkUnitAttemptStatus` member; chain-hash computation; tail-repair truncation logic; lease-file parse/validate; idempotency key comparison.
- **Property (fast-check):** lease acquire/renew/release interleavings under simulated clocks (forged PID/start-time never wins takeover); randomized torn-write injection points always recover to a valid chain prefix; randomized `(operationId, contentHash)` sequences never produce a silent overwrite; snapshot+replay reconstructs state identical to a full replay-from-genesis across randomized snapshot points.
- **Integration:** real filesystem in tmp dirs (real fsync, not mocked); evidence query surface against a fixture journal spanning all 13 entry types; kill harness end-to-end against the append/chain/snapshot path.
- **Conformance:** not applicable as a dedicated group — 04 has no external wire protocol to conform to (that's 03/06's engine conformance and 16's provider conformance). Its cross-phase conformance obligation is the byte-identical `JournalEntryType`/`WorkUnitAttemptStatus` round-trip, covered under Unit above.
- **Security:** hash-chain tamper detection — a post-hoc single-byte modification of a historical entry (not a torn write) must fail verification, the property distinguishing integrity-checking from mere corruption-recovery; directory/file permission enforcement (`0700`/`0600`, denied to other local uids); idempotency registry resists an operationId collision from a different content hash (never silently prefers the newer write).

## Exit criteria

- [ ] 1k randomized kill-iteration run (`runKillHarness` over the append/chain/snapshot path): zero undetected corruption; recovery always converges to the last valid chained entry — evidence: `journal-crash-suite` CI job artifact.
- [ ] All 13 `JournalEntryType` members and every `WorkUnitAttemptStatus` member round-trip through the codec with full schema-branch coverage — evidence: codec round-trip suite + coverage report.
- [ ] Idempotency semantics proven: same `(operationId, contentHash)` replays a byte-identical result; changed content fails a typed conflict, never silently overwrites — evidence: idempotency property-test suite.
- [ ] Two-process lease contention resolves to exactly one holder; takeover fires only on expiry **and** start-time mismatch, never against a live process — evidence: lease-contention integration test.
- [ ] fsync ordering (`write → fsync(file) → fsync(dir)`) asserted on the real append path — evidence: strace-based CI assertion (Linux), or an injected fs-shim equivalent where strace is unavailable.
- [ ] Snapshot+replay recovery reconstructs state identical to a full replay-from-genesis across randomized snapshot points — evidence: snapshot-equivalence property suite.
- [ ] Evidence query surface returns the exact `EvidenceRecord` set filtered by run/change-set/work-unit ID against a fixture journal spanning all 13 entry types — evidence: query-surface integration test.
- [ ] A `parked:rate_limit` attempt record retains its `session_id` across a simulated crash+recover cycle — evidence: targeted crash-recovery test (the property §0's pause-and-resume policy depends on).
- [ ] Append p50 latency documented with a CI regression gate — evidence: benchmark output committed, gate wired into CI.
- [ ] `runKillHarness` ships as a stable, independently unit-tested export (parameterized fault points → structured report) — evidence: harness unit tests plus the exported signature 07's test plan names as "the phase-04 kill harness."
- [ ] `$XDG_STATE_HOME`/`$XDG_CACHE_HOME` engineering-orchestrator roots are defined exactly once in this package — evidence: repo-wide lint/grep CI check fails if another package reimplements the root instead of importing it.

## Risks & open questions

- fsync semantics differ on WSL2 9p mounts for both the state and cache roots — supported-locations doc; `doctor` (09) warns on `/mnt/c`-resident state/cache dirs.
- Unlike 03/06/16, this phase asserts no unconfirmed engine fact (adaptation §10 items 2/3/10): the only engine-adjacent field it persists is `session_id`, treated as an opaque string, never parsed against engine-specific format assumptions.
- Adaptation §10 risk 9 (subscription-auth workers share rate/usage limits) makes this phase's `parked:rate_limit` + `session_id` retention load-bearing for the confirmed pause-and-resume policy (§0) — a durability gap here silently breaks pause-and-resume, not just crash recovery.
- Retention/GC numeric thresholds (segment age/size) are left as an implementation-time tuning question, not a build blocker; the only hard invariant is never deleting a segment newer than the latest durable snapshot.
- Risk: if `runKillHarness` is too coupled to journal-specific internals to be genuinely reusable, 07/05/13/23 may each reimplement fault injection independently, fragmenting crash-test rigor — mitigate by keeping the harness parameterized over an arbitrary operation callback.
- The `$XDG_CACHE_HOME` path form used here (`<project-hash>` immediately under `engineering-orchestrator/`, subpaths nested beneath it) resolves an internal inconsistency between two passages of the binding resolutions doc's own Gap-14 text (one passage describes the P07 subpath as `git-control/<project-hash>/`; the literal quoted edit given for P07 is `<project-hash>/git-control/`). This file follows the literal, twice-repeated form used in both P07's and P12's quoted edits, matching this phase's existing `$XDG_STATE_HOME` pattern — flagged for Reconcile to confirm 07 and 12 land on the same order.
