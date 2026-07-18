# Phase 04 evidence

This directory is the evidence trail for `roadmap/04-journal-idempotency-leases.md`'s
exit criteria, following the same convention `docs/evidence/phase-02/README.md`
established: each file name is prefixed `wiN-` (work item N) or
`exit-criteria-`, describes what it captures, and — where the phase's own
choreography calls for "failing-first" — a `*-failing.txt` file captured
**before** the fix/implementation landed, paired with a `*-passing.txt` (or
`*-passing-*.txt`) file captured **after**.

Three workers built this phase. W3 built the codec, store (append/chain/
snapshot/query/retention), layout, and kill-harness fixtures scaffolding.
W4 built the lease module and `runKillHarness` itself. This worker (W5, the
integration worker) built the idempotency registry, work-unit attempt
tracking, the randomized real-kill crash suite, the append-latency
benchmark + CI regression gate, the XDG sole-definition-site check, and
rewrote the public barrel — then ran the package-scoped and full-repo
gates. Evidence files are grouped by which worker/pass produced them below.

Dates: 2026-07-17 for W3/W4's captures (a prior session); 2026-07-18 for
this integration pass's captures (W5).

## Exit-criteria → evidence map

The roadmap file's own `## Exit criteria` section lists **11** checkboxes
(verified by direct count against `roadmap/04-journal-idempotency-leases.md`
lines 84-94) — this worker's brief referred to "12," which appears to be an
off-by-one in that brief; all 11 actual checkboxes are mapped below, none
skipped.

| # | Exit criterion (roadmap/04-journal-idempotency-leases.md) | Evidence file(s) | Worker |
| --- | --- | --- | --- |
| 1 | 1k randomized kill-iteration run (`runKillHarness` over the append/chain/snapshot path): zero undetected corruption; recovery always converges — evidence: `journal-crash-suite` CI job artifact | `exit-criteria-crash-suite-red.txt` (RED: corruption-detection self-check against a seeded-broken append variant, proving the fault-injection scaffolding has teeth), `exit-criteria-crash-suite-passing.txt` (GREEN: same file, default 25-iteration scale, both describe blocks), `exit-criteria-crash-suite.txt` (the committed large-scale run — **1000/1000 iterations achieved**, ~94s, zero undetected corruption) | W5 |
| 2 | All 13 `JournalEntryType` members and every `WorkUnitAttemptStatus` member round-trip through the codec with full schema-branch coverage — evidence: codec round-trip suite + coverage report | `wi1-codec-failing.txt`, `wi1-codec-passing.txt`; coverage in `exit-criteria-package-gate.txt` | W3 |
| 3 | Idempotency semantics proven: same `(operationId, contentHash)` replays a byte-identical result; changed content fails a typed conflict, never silently overwrites — evidence: idempotency property-test suite | `wi5-idempotency-failing.txt` (RED: same-id-same-hash replay + conflict assertions fail against a naive always-re-execute stub), `wi5-idempotency-passing.txt` (GREEN: 9/9 at initial capture, 13/13 after later additions covering defensive branches — see Deviations — including the fast-check "randomized sequences never produce a silent overwrite" property suite) | W5 |
| 4 | Two-process lease contention resolves to exactly one holder; takeover fires only on expiry **and** start-time mismatch, never against a live process — evidence: lease-contention integration test | `wi6-lease-failing.txt`, `wi6-lease-passing.txt` (two-real-child-process `O_EXCL` contention test) | W4 |
| 5 | fsync ordering (`write → fsync(file) → fsync(dir)`) asserted on the real append path — evidence: strace-based CI assertion (Linux), or an injected fs-shim equivalent where strace is unavailable | `wi2-fsync-append-failing.txt`, `wi2-fsync-append-passing.txt`; the durable, standing assertion is `packages/journal/src/store/durable-io.test.ts`'s `"performs write -> fsync(file) -> fsync(dir), in exactly that order, on the real fs port"` test — a REAL `createNodeFsPort()` against a real tmp dir, wrapped only with the recording shim (`store/testing/recording-fs-port.ts`) to observe call order; `strace` was checked on this machine (`which strace`) and is **not installed**, so this fs-shim IS the criterion's own explicit documented fallback, not a workaround | W3 (test + fallback), W5 (confirmed `strace` unavailable, verified the assertion still stands on the real path) |
| 6 | Snapshot+replay recovery reconstructs state identical to a full replay-from-genesis across randomized snapshot points — evidence: snapshot-equivalence property suite | `wi3-chain-snapshot-failing.txt`, `wi3-chain-snapshot-passing.txt`; property suite: `packages/journal/src/store/journal-recovery-properties.test.ts` ("property: snapshot+replay reconstructs identical state to full replay-from-genesis") | W3 |
| 7 | Evidence query surface returns the exact `EvidenceRecord` set filtered by run/change-set/work-unit ID against a fixture journal spanning all 13 entry types — evidence: query-surface integration test | `wi4-query-failing.txt`, `wi4-query-passing.txt` | W3 |
| 8 | A `parked:rate_limit` attempt record retains its `session_id` across a simulated crash+recover cycle — evidence: targeted crash-recovery test | `wi5-attempts-failing.txt` (RED: a stub `recordAttempt` that drops `sessionId` and a `getLatestAttempt` that returns the FIRST instead of latest attempt — both fail at the assertion level, including the exit-criterion test itself), `wi5-attempts-passing.txt` (GREEN: 6/6 at initial capture, 7/7 after a later defensive-branch addition — see Deviations — including the dedicated "EXIT CRITERION" describe block — torn-tail simulated crash immediately after a `parked:rate_limit` write, repaired, then `getLatestAttempt` still reports the exact `session_id`) | W5 |
| 9 | Append p50 latency documented with a CI regression gate — evidence: benchmark output committed, gate wired into CI | `exit-criteria-append-benchmark.txt` (1000 real appends, p50 = 2.31ms); regression gate: `packages/journal/src/store/append-benchmark.test.ts` (asserts p50 < 100ms, a >40x documented-generous margin, given roadmap/04's own WSL2/9p fsync-variance risk note); CI wiring: `.github/workflows/ci.yml`'s `test` job already runs `npm run build && npm test` (`npm test` = `vitest run --coverage`) — **no CI YAML changes were needed or made**, confirmed by inspection | W5 |
| 10 | `runKillHarness` ships as a stable, independently unit-tested export (parameterized fault points → structured report) — evidence: harness unit tests plus the exported signature 07's test plan names as "the phase-04 kill harness" | `wi7-kill-harness-failing.txt`, `wi7-kill-harness-passing.txt`; re-exercised end-to-end by this worker's own crash suite (`packages/journal/src/crash-fixtures/crash-suite.test.ts`), proving it is genuinely reusable against an arbitrary operation beyond its own original fixtures | W4 (module), W5 (reuse proof) |
| 11 | `$XDG_STATE_HOME`/`$XDG_CACHE_HOME` engineering-orchestrator roots are defined exactly once in this package — evidence: repo-wide lint/grep CI check | `exit-criteria-xdg-sole-definition.txt`; check itself: `packages/journal/src/layout/xdg-sole-definition.test.ts` (AND-based detection: flags a file outside `packages/journal/src` only when it contains BOTH the `"engineering-orchestrator"` namespace literal AND an `XDG_STATE_HOME`/`XDG_CACHE_HOME` reference — allowlisting `packages/engine-core`'s documented tilde-anchored literal defaults, which don't reference the env vars at all and so don't trigger the AND rule; two sanity tests guard the detection rule itself against silently becoming a no-op) | W5 |

## Additional integration-pass evidence

| What | Evidence file |
| --- | --- |
| Package-scoped gate (`tsc -b packages/journal` clean; `vitest run --coverage.enabled=false packages/journal` all green; full-package coverage run) | `exit-criteria-package-gate.txt` |

## Deviations

0. **Coverage-driven additions after the initial RED/GREEN captures.** After the initial `wi5-idempotency-passing.txt` (9/9) and `wi5-attempts-passing.txt` (6/6) captures, this worker's own full-package coverage run (`npx vitest run --coverage packages/journal`) showed `idempotency.ts` and `attempts.ts` branch coverage just under 80% (71.42% and 75% respectively) — both gaps were defensive type-guard branches ("should never happen through the normal query path, guarded defensively"). Rather than leave them uncovered, the guarded logic was extracted into standalone exported functions (`assertRemoteOperationRecordEntry`, `toAttemptRecord`) and directly unit-tested with hand-crafted wrong-type `JournalEntry` fixtures, plus three more idempotency tests covering hand-crafted-fixture edge cases the source's own comments already named (a duplicate `remote_operation_record` for one `operationId`; a record with no `appliedRevision`; a wrong-typed entry reaching the index-building scan via a fake store). Final counts: `idempotency.test.ts` 13/13 (100% line/branch/function coverage), `attempts.test.ts` 7/7 (100%/81.25%/100%/100%). This is why the exit-criteria table above cites both the original and final test counts.
1. **Idempotency registry journal-entry-type decision (work item 5's own "decide and document" instruction).** `IdempotencyRegistry` (`packages/journal/src/idempotency.ts`) persists every record as a `remote_operation_record` entry — the only one of the 13 closed `JournalEntryType` members shaped for an `(operationId, contentHash, status)` triple, and `JOURNAL_ENTRY_TYPE_DESCRIPTIONS.remote_operation_record` itself is captioned "...16's idempotency registry, 04," already tying this entry type to 04's own registry, not solely 16's pipeline. Since `RemoteOperationRecordSchema` (02, out of this package's authority to extend) has no free-form "result" field, the registry's own arbitrary `compute()` result is JSON-serialized into the `appliedRevision` field (documented as a deliberate, narrow reuse of that field's free-text shape) and `remoteMutationPlanId` (required, UUID) is set to the record's own freshly generated `id` — a documented self-referential placeholder for callers with no real `RemoteMutationPlan`. Full rationale in `idempotency.ts`'s own file-level doc comment.
2. **Idempotency registry concurrency limitation (documented, mirroring `lease.ts`'s own residual-race precedent).** `checkOrRecord` is proven correct under sequential calls (including via a fast-check property suite) but is NOT safe against two truly concurrent, overlapping FIRST-time calls for the same never-before-seen `operationId` — both could observe "no prior record" before either persists. Closing this fully requires an atomic claim primitive this module does not implement (out of scope for this phase per the roadmap's own text: 04 supplies the primitive, not a distributed lock). See `idempotency.ts`'s "CONCURRENCY" doc-comment section.
3. **W4's documented lease-takeover TOCTOU residual (pre-existing, left as-is per this worker's brief).** `packages/journal/src/lease.ts`'s `tryAcquireOnce` doc comment documents a residual race in the CONTENDED/takeover path: two processes can both independently pass eligibility and both `rename()` in quick succession; if a loser's post-rename verification read is scheduled between the two `rename()` calls (rather than strictly after both), it can incorrectly believe it won too. Not touched by this worker, per explicit brief instruction ("leave as is").
4. **A one-off flake was observed in `lease.test.ts`'s two-real-child-process `O_EXCL` contention test** (`"exactly one of two real, concurrently-spawned child processes acquires the lease"`) when run as part of the FULL `packages/journal` suite immediately after a heavy prior run (the 1000-iteration crash suite). Re-run three times immediately after, alone and as part of the full suite, and passed cleanly every time — this looks like transient system-load-induced timing sensitivity in a test that spawns two real OS processes and asserts on real `O_EXCL` race timing, not a regression introduced by this integration pass (this worker did not modify `lease.ts`/`lease.test.ts`/`lease-fixtures/**`). Recorded here for transparency; the final package-gate capture (`exit-criteria-package-gate.txt`) shows a clean run.
5. **Crash suite: two bugs found and fixed while building `packages/journal/src/crash-fixtures/**` (this worker's own new code, not a prior worker's).**
   - The initial seeded PRNG in `crash-suite.test.ts` used plain `state * 1103515245`, which silently overflows JS's 53-bit float mantissa for `state` values above ~8.1M, producing a badly degenerate sequence (every iteration picked the same mode/fault point). Fixed to use `Math.imul` for real 32-bit integer multiplication.
   - `prepareCrashSuiteRuntime` (`crash-fixtures/prepare-runtime.ts`) originally only transpiled the named entry script itself, not `signaling-fs-port.ts` — a second file colocated in `crash-fixtures/` that the entry script imports. Every real (non-corruption-check) crash-suite run crashed with `ERR_MODULE_NOT_FOUND` until `CRASH_SUITE_LOCAL_FIXTURE_FILES` was added to also transpile colocated fixture-local dependencies into the same scratch output subdirectory.
   Both bugs were caught by this worker's own test runs before any evidence was captured as final; `exit-criteria-crash-suite-passing.txt` documents both fixes.
6. **The crash suite's "real kill" methodology, and what it does and doesn't prove (documented for honesty).** A real `SIGKILL` on a still-running OS/filesystem does not, by itself, simulate power loss — the kernel's page cache is unaffected by process death, so `fsync()` ordering specifically is NOT exercised by this mechanism (that's what exit criterion 5's fs-shim assertion is for, on the REAL append path — see row 5 above). What the crash suite's genuine `SIGKILL`s DO prove, that a simulated/hand-truncated torn-write test cannot: the real child process's actual behavior under abrupt termination at every real internal step (fd leaks, orphaned `.tmp-*` files, directory-entry consistency, and the store remaining genuinely writable afterward) — complementary to, not a replacement for, `journal-recovery-properties.test.ts`'s existing fast-check-based simulated-torn-write property suite (exit criterion 6's neighbor invariant).
7. **This worker's own barrel rewrite (`packages/journal/src/index.ts`).** The pre-existing file was a one-line stub (`export {};`, phase-01 scaffolding). Replaced with the full public surface described in the exit-criteria table above and this file's own doc comment. A grep-based repo-scoped export-name collision check across every non-test `.ts` file's top-level `export` declarations in `packages/journal/src` found exactly one duplicate identifier, `FixtureRuntime` — exported independently by both `lease-fixtures/prepare-runtime.ts` and `crash-fixtures/prepare-runtime.ts` (two unrelated, same-shaped test-support helper types) — neither is re-exported through the public barrel, so this is not a barrel-surface collision, just a note for anyone later trying to `export *` either fixtures directory directly.
8. **`packages/journal/src/index.ts` (the barrel) was a phase-01-era empty stub** (`export {};`), not prior-phase-04-worker content — replacing it is new work, not an edit to another worker's deliverable.
9. **One genuine edit to a W3 file: `packages/journal/src/store/journal-recovery-properties.test.ts`'s cut-range calculation had a rare off-by-one edge case.** During this worker's full-package gate run, the fast-check property "recovers to a valid chain prefix across randomized entry counts and cut points" failed with counterexample `entryCount=2, cutSeed=561` — `expect(beforeRepair.firstIssue).toBeDefined()` got `undefined`. Root cause: `cutInto = 1 + (cutSeed % Math.max(1, lastLineLength - 1))` could reach `cutInto === jsonContentLength` (since `lastLineLength = jsonContentLength + 1`, including the trailing `"\n"`), which strips ONLY the last line's trailing newline byte — the JSON content itself stays fully intact and parseable, so `verifyChain` correctly reports no issue (this is not corruption, just a byte-identical file minus one delimiter byte) rather than a genuine torn write. This is a flaw in the TEST's own byte-cut range, not a defect in `appendEntry`/`verifyChain`/`repairChain`. Fixed by capping the modulus at `lastLineLength - 2` so `cutInto` always lands strictly within the JSON content. Confirmed: 12/12 clean re-runs after the fix (vs. an intermittent flake before — reproduced and gone), full package suite green, `tsc -b`/lint/format all clean. This is the one prior-worker-file edit this worker made, exercising the "you may edit anything in packages/journal, including prior workers' files for integration fixes — document every such change" authorization.

## Validation round (2026-07-18)

An adversarial Opus validator reproduced 2 MAJOR defects and 3 MINORs against the
otherwise-green phase-04 build (244 tests). A dedicated fix worker addressed all of
them under TDD (RED against unfixed code, captured, then fixed to GREEN). Final count:
**262/262 tests green** (244 original + 18 new regression/coverage tests). All changes
stayed within `packages/journal`.

A fresh adversarial Opus re-audit then reproduced every fix as genuinely closed and
raised one residual **MINOR** footgun: the low-level per-segment `verifyChain`/
`repairChain` functions kept their `expectedInitialPrevHash = GENESIS_PREV_HASH`
defaults (correct only for segment 1) and were still re-exported from the package
barrel, so a future 05/07/16 consumer could reach the same destructive path by calling
them directly with the default on a rotated segment (no current caller does — nothing
outside `packages/journal` imports `@eo/journal` yet). Closed at integration by removing
those two functions from `packages/journal/src/index.ts`'s public surface entirely: the
whole-journal-safe `verifyJournal`/`repairJournal` (which thread `prevHash`/`seq` across
segment boundaries) and the `JournalStore` methods remain the only exported recovery
surface; the per-segment functions stay module-internal, still composed by
`repair-journal.ts` and still fully exercised by their own colocated tests via direct
relative import. `tsc -b` clean and 262/262 green after the removal.

### MAJOR 1 — rotated-journal repair destroyed committed entries, duplicated `seq`

**Defect** (`repair-chain.ts:54-57` + `journal-store.ts:58-59`): `JournalStore.repairChain
(segmentPath, expectedInitialPrevHash = GENESIS_PREV_HASH)` defaulted the expected prior
hash to genesis regardless of which segment was passed. On a rotated journal
(segments `[1,2,3]`, one valid committed entry each), calling `store.repairChain
(highestSegmentPath)` misreported segment 3's own valid first entry as
`prev_hash_mismatch` (its real `prevHash` is segment 2's last hash, not genesis),
truncated the WHOLE segment to 0 bytes (destroying the real seq=3 entry), and the
repair-record append then started a FRESH chain at seq=1 — a duplicate of segment 1's
own seq=1, corrupting the journal's global monotonic-seq invariant. The 1000-iteration
crash suite never rotated segments, so this path had zero coverage.

**Fix** (F1):
- `packages/journal/src/store/verify-journal.ts` (new): `verifyJournal(config)` walks
  every segment in ascending order, threading `expectedInitialPrevHash`/
  `expectedInitialSeq` across each segment boundary (segment N+1's expected initial
  prevHash/seq = segment N's own last valid entry's hash/seq+1). Decides
  `firstInvalid.isTailPosition`: `true` only when nothing decodable exists anywhere
  after the break (later lines in the same segment, or any later segment) — the
  roadmap's own "property distinguishing integrity-checking from mere
  corruption-recovery."
- `packages/journal/src/store/repair-journal.ts` (new): `repairJournal(config)` verifies
  the whole journal; no-ops if valid; tail-repairs (via the low-level `repairChain`,
  given the CORRECT threaded `expectedInitialPrevHash`) only when `isTailPosition` is
  `true`; otherwise throws `JournalTamperedError` naming the exact segment/line/reason
  rather than truncating real data.
- `packages/journal/src/store/append-entry.ts:readLastEntryAcrossSegments` (new): the
  "last entry" lookup now walks BACKWARD across segments when the highest-indexed
  segment is genuinely empty (e.g. right after a repair truncated it to 0 bytes),
  instead of assuming an empty highest segment means "start of journal" — this is what
  makes the repair-record's `seq`/`prevHash` continue correctly across a rotation
  boundary, fixing the duplicate-seq symptom.
- `packages/journal/src/store/verify-chain.ts`: gained an optional 4th parameter,
  `expectedInitialSeq` — when supplied, the first valid entry's `seq` is checked against
  it too (previously only monotonicity FROM the first entry was checked, never its
  actual starting value), closing the cross-segment seq-continuity gap.
- `packages/journal/src/store/journal-store.ts`: `JournalStore.verifyChain`/
  `.repairChain()` (the unsafe, defaulted-genesis convenience methods) were REMOVED from
  the store's own surface, replaced by `.verifyJournal()`/`.repairJournal()`. The
  low-level, single-segment `verifyChain`/`repairChain` functions are UNCHANGED and
  still directly barrel-exported for tests/power users who explicitly want one named
  segment — just no longer reachable through the store's convenience surface with an
  implicit, dangerous default. **Judgment call**: the brief asked to also strip the
  default off the low-level functions entirely (~25 call sites across existing tests
  all pass a segment-1 path, where genesis IS correct). Removing the store-level
  convenience method closes the actual vulnerability the validator found; stripping the
  low-level default too would have meant editing ~25 pre-existing, still-correct test
  call sites for no behavior change, at real risk of an editing mistake, for no
  additional safety (the low-level functions are exposed for tests, exactly as the
  brief says to keep them). Judged not worth the risk/churn; documented here per the
  brief's own "anything judged differently" instruction.
- `packages/journal/src/store/snapshot-io.ts`: `recover(config, runId)` now calls
  `repairJournal` BEFORE replaying (tail-repairing a genuine torn write in place, or
  throwing `JournalTamperedError` on mid-journal corruption instead of silently
  replaying past it — this also closes MINOR 4). `RecoverResult` gained `verification`
  (always present) and `repair` (present only when a repair actually happened) fields.
- `packages/journal/src/crash-fixtures/`: `append-chain-snapshot-operation.ts` gained an
  optional `EO_CRASH_FIXTURE_SEGMENT_MAX_BYTES` env var; `crash-suite.test.ts` gained a
  SECOND, dedicated "segment rotation variant" describe block (small `segmentMaxBytes`,
  forcing a fresh segment on every append) alongside the original variant, and both
  `verifyAppendRecovery`/`verifySnapshotRecovery` were updated to call the orchestrated
  `verifyJournal`/`repairJournal` instead of operating on `segmentPath(..., FIRST_SEQ)`
  directly.

**Regression evidence**: `fix1-rotated-repair-failing.txt` (RED — the validator's exact
repro, `store.repairChain(highestSegmentPath)` against a 3-segment journal, asserting
`[1,2,3]` but observing `[1,2,1]`), `fix1-rotated-repair-passing.txt` (GREEN, same
assertions via `store.repairJournal()`). Additional dedicated unit coverage:
`store/verify-journal.test.ts`, `store/repair-journal.test.ts` (mid-journal tamper
REFUSE repro, seq-continuity-across-rotation repro, tail-vs-mid-journal detection).

### MAJOR 2 — out-of-band lease-file removal → silent double holder

**Defect** (`lease.ts`, pre-fix `#renew`): holder A's `#startHeartbeat` swallowed ALL
renew failures; `held` stayed `true` regardless; `#renew`'s temp+rename-replace had NO
ownership guard (asymmetric with `#release()`'s own `stillOurs` check). Repro: A
acquires; the lease file is deleted out-of-band; B acquires via the legitimate O_EXCL
fast path (the file is genuinely absent); now both `A.held` and `B.held` are `true`; A's
next renew rename-CLOBBERS B's file.

**Fix** (F2): `#renew` now reads the current on-disk record FIRST and revalidates
ownership (pid/startTimeTicks/acquiredAtMs) before ever writing. Missing or owned by a
different record → lost IMMEDIATELY, nothing written, `held` becomes `false`,
`renewNow()` rejects `LeaseLostError` (`reason: "missing" | "ownership_mismatch"`). A
transient filesystem error (the read/write/rename itself fails, not an ownership
mismatch) → lost only once such failures have persisted continuously for at least
`ttlMs` (`reason: "transient_ttl_exceeded"`); `held` stays `true` and `renewNow()`
rejects the raw underlying error until the TTL is actually exceeded. New
`lastHeartbeatError`/`lostReason` getters and an `onLeaseLost` constructor option
surface loss to a caller that only uses the automatic background heartbeat.
`release()` after loss stays a no-op (already guarded by the same `#released` flag).
The already-documented `tryAcquireOnce` takeover-race TOCTOU residual is UNCHANGED —
out of this fix's scope, per the brief.

`lease.ts` was split into `lease-errors.ts` (typed error classes) and
`lease-acquire.ts` (`tryAcquireOnce` and its private helpers) to stay under this repo's
400-line-file convention after the fix — `lease-fixtures/prepare-runtime.ts`'s fixture
source-file list was updated accordingly (documented prior-worker-file edit).

**Regression evidence**: `fix2-lease-double-holder-failing.txt` (RED — A/B/out-of-band
repro, asserting `renewNow()` rejects; observed it resolving and clobbering B's file
instead), `fix2-lease-double-holder-passing.txt` (GREEN, same repro, now asserting the
typed `LeaseLostError`/`lostReason`/byte-identical-B's-file invariants).

### MINOR 3 — idempotency recorded-vs-replayed divergence

**Fix** (F3): `IdempotencyRegistry.checkOrRecord`'s "recorded" branch now round-trips
`result` through the same JSON encode/decode replay already used
(`decodeResult<T>(record.appliedRevision ?? "")`) before returning it, so a `Date`,
`NaN`/`Infinity`, or `undefined`-valued object member coerces IDENTICALLY on the first
call and every later replay. `checkOrRecord`'s own doc comment now states the
JSON-value-domain restriction explicitly. New test:
`idempotency.test.ts`'s "VALIDATION ROUND ... MINOR 3 regression" describe block
(non-JSON-safe input; asserts `first.result` and `second.result` are `toEqual`).

### MINOR 4 — `recover()` performed no integrity verification

Closed as part of F1 above: `recover()` now calls `repairJournal` before replaying, so a
post-hoc tampered but schema-valid entry throws `JournalTamperedError` instead of
replaying silently.

### MINOR 5 — idempotency concurrency limit (doc-comment only, no code change)

`checkOrRecord`'s own doc comment was tightened to state the sequential-only
concurrency limit crisply (two truly concurrent first-time calls for the same
never-before-seen `operationId` can both append) — no behavior change, per the brief.

### `acquireProjectLease` (exit-criteria validator, accepted-MINOR)

roadmap's own `## Interfaces produced` text names `Lease.acquire(projectHash)`; the real
primary API is `Lease.acquire(leaseDir, projectHash, opts)`. Added
`packages/journal/src/lease-project.ts`'s `acquireProjectLease(projectHash, opts?)`,
resolving `leaseDir` via `layout/xdg-layout.ts`'s `resolveLeasesDir` +
`readXdgEnvFromProcess` and delegating to the explicit-dir form (kept as the primary,
testable API, unchanged). Barrel-exported. New test file: `lease-project.test.ts`.

### API changes downstream phases (05/07/16) must know

- `JournalStore.verifyChain(segmentFilePath, expectedInitialPrevHash?)` and
  `.repairChain(segmentFilePath, expectedInitialPrevHash?)` are REMOVED from the bound
  store object. Use `store.verifyJournal()` / `store.repairJournal()` instead (no
  arguments — operates over the whole journal). The standalone, low-level
  `verifyChain`/`repairChain` functions are unchanged and still barrel-exported for
  tests/direct single-segment use.
- `recover(config, runId)` / `store.recover(runId)` now performs whole-journal
  verification (and tail-repair if needed) BEFORE replaying, and can now THROW
  `JournalTamperedError` if mid-journal corruption is detected — a caller that
  previously assumed `recover()` never throws must handle this. `RecoverResult` gained
  `verification` (always present) and `repair` (present only when a repair happened).
- `IdempotencyRegistry.checkOrRecord`'s "recorded" result is now JSON-round-tripped
  (previously the raw `compute()` return value) — callers passing non-JSON-safe types
  (`Date`, `NaN`, class instances) will observe the coerced value even on the very first
  call, not just on replay.
- `Lease#renewNow()` can now reject with `LeaseLostError` (in addition to whatever it
  could already throw) — callers awaiting it directly must handle this; callers relying
  on the automatic background heartbeat should read the new `lastHeartbeatError`/
  `lostReason` getters or pass `onLeaseLost`.
- New export: `acquireProjectLease(projectHash, opts?)`.

### Anything incomplete

Nothing scoped to this fix pass is incomplete. The pre-existing, already-documented
`tryAcquireOnce` takeover-race TOCTOU residual (Deviation #3 above) remains open by
explicit brief instruction — unchanged, not this pass's scope.

## Design decisions recorded (within this worker's authority, not ambiguities)

- **Work-unit attempt tracking module split** (`packages/journal/src/attempts.ts`): `recordAttempt` auto-populates `previousStatus` from the work unit's own latest prior attempt (a read-back convenience for humans/CLI readers) — not required by the closed-union round-trip itself, but a low-cost enrichment `WorkUnitTransitionPayloadSchema`'s own optional `previousStatus` field already supports.
- **Benchmark threshold** (`packages/journal/src/store/append-benchmark.test.ts`): p50 < 100ms, deliberately ~40x above the 2.31ms actually measured on this machine, specifically because roadmap/04's own §Risks note flags WSL2 9p-mount fsync-semantics variance — this repo's own dev environment IS WSL2 — so a tight threshold would make the CI gate flaky across contributors' machines rather than catching genuine regressions.
- **Crash suite fault-point granularity**: 7 real internal steps for the append path (`open(file)`, `write`, `fsync(file)`, `close(file)`, `open(dir)`, `fsync(dir)`, `close(dir)` — exactly `durablyAppendLine`'s own call sequence) and 8 for the snapshot path (adds `rename`) — chosen to match the REAL durable-io call sequence exactly, so every fault point genuinely corresponds to a real syscall boundary in production code, not an arbitrary sampling.
