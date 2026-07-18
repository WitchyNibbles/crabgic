# Phase 05 evidence

This directory is the evidence trail for `roadmap/05-supervisor-daemon.md`'s exit criteria,
following the same convention `docs/evidence/phase-02/README.md` established: each file name
is prefixed `wiN-` (work item N) or `exit-criteria-`, describes what it captures, and — where
the phase's own choreography calls for "failing-first" — a `*-failing.txt` file captured
**before** the fix/implementation landed, paired with a `*-passing.txt` file captured
**after**. Dates below are as captured during this worker's single session (2026-07-18).

One worker built this phase's entire `packages/supervisor` deliverable in one continuous TDD
pass, work item by work item, in the order the roadmap lists them (WI1 → WI7). Every
`*-failing.txt` file in this directory is a **genuine, assertion-level RED capture** against a
minimal, deliberately-wrong stub implementation (never a bare "module does not exist" capture)
— each stub is described in the corresponding source file's own top-of-file comment
("NAIVE STUB (deliberate, temporary)") and in the paired `-failing.txt`/`-passing.txt` pair
below.

## Exit-criteria → evidence map

| Exit criterion (roadmap/05-supervisor-daemon.md) | Evidence file(s) |
| --- | --- |
| Foreign-uid peer refused (unit-tested check; integration where CI permits) | `wi2-peer-auth-failing.txt` (naive fail-open middleware admits a foreign uid, throws, and hangs — 3 genuine assertion failures), `wi2-peer-auth-passing.txt` (real fail-closed middleware, incl. a real `SO_PEERCRED` integration test over a real self-connected UDS socket), `wi2-uds-integration-passing.txt` (foreign-uid connection destroyed before the handshake, over a real socket) |
| Two same-uid local connections (CLI + gateway stand-ins) both clear `SO_PEERCRED` against the identical router and receive identical `run.status`/`run.cancel` responses | `packages/supervisor/src/socket/uds-server.concurrent.test.ts` (committed test, not separately captured — its passing run is included in `exit-criteria-package-gate.txt`'s full-suite section); ran standalone at `wi2-uds-integration-passing.txt`'s capture time alongside the other socket-integration tests |
| kill -9 mid-operation → restart recovers registries via 04's `recover(runId)`; no duplicated side effects | `wi3-kill-restart-recovery-passing.txt` — reuses 04's real `runKillHarness` against a plain `.mjs` fixture (`packages/supervisor/src/socket/kill-harness-fixtures/append-transitions-and-crash.mjs`) that appends two `run_transition` entries via a real `@eo/journal` `JournalStore`, signaling a fault point between them; the harness SIGKILLs the child the instant it observes the marker; the in-process `verify` callback creates a brand-new `JournalStore` + brand-new (empty) registries over the same on-disk journal dir (a genuine "restart") and asserts `recoverRun` never throws and the replayed `run_transition` chain contains no duplicate `(from,to)` pair and no duplicate `seq` |
| Hung fake worker fully reaped within deadline | `wi4-termination-ladder-failing.txt` (naive no-op ladder never escalates — genuine timeout-based assertion failure), `wi4-termination-ladder-passing.txt` (real SIGTERM → grace → SIGKILL ladder, both against a deliberately non-cooperative hand-rolled `EngineAdapter` double proving the forced/SIGKILL-equivalent path in isolation, and against `@eo/testkit`'s real `FakeEngineAdapter`'s `hang` failure mode proving the graceful path — see Deviations #3 for why two doubles were needed); `wi4-orphan-reaper-passing.txt` (startup orphan sweep: journals a failed attempt, marks the worker `crashed`, fires the recovery-hook call site); `wi4-worker-lifecycle-passing.txt` (the full spawn → journal-tee → crash-detection pipeline against the real fake engine, incl. a genuine thrown-iterator crash scenario) |
| Slow subscriber never stalls a worker; drops surfaced | `wi5-ring-buffer-failing.txt` (naive PassThrough-stream-backed buffer genuinely stalls `push()` once a paused, never-drained subscriber's internal buffer fills — real timeout-based assertion failure, not a contrived one), `wi5-ring-buffer-passing.txt` (real backpressured, byte-capacity-bounded ring buffer — `push()` never blocks), `wi5-ring-buffer-property-passing.txt` (fast-check, 1000 runs: randomized concurrent-subscriber push/poll sequences, average per-push latency bounded and drop counts always non-negative integers) |
| Idle budget test green with documented numbers (<100 MiB RSS, <1% of one core, 5 s heartbeat) | `wi6-heartbeat-scheduler-failing.txt` (naive `setImmediate`-recursion "always-polling" scheduler measured at **~117% of one core** over a 300ms window — 100× over budget), `wi6-heartbeat-scheduler-passing.txt` (real `setInterval`-paced, `unref()`'d scheduler, same 300ms-window assertion, green), `wi6-idle-budget-measured-numbers.txt` (the documented numbers, captured via `--reporter=verbose` so the test's own `console.log` line survives: **RSS = 69 MiB (budget <100 MiB), CPU = 0.1083% of one core (budget <1%)**, measured over a sustained 1500ms no-op window using the REAL, unmodified 5000ms `HEARTBEAT_INTERVAL_MS`), `wi6-idle-budget-full-passing.txt` (full `idle-budget/` suite green) |
| A repo-wide check confirms no `change_set.*`-named operation exists anywhere in this package's router or registry surface | `wi2-gap1-conformance-passing.txt` — two independent checks: (1) `SUPERVISOR_OPERATIONS`, the router's own live registered-operation vocabulary, contains no change-set-family-prefixed name; (2) a raw-text scan (mirroring `packages/contracts/src/gateway/server-name.ts`'s own sole-definition-site scanner convention — a `.split()` over every non-test `.ts` file, catching even a doc-comment mention) over every source file under `packages/supervisor/src` confirms the literal string is never present. Caught and fixed two accidental doc-comment mentions of the banned literal during development (`router/operations.ts`, `registries/change-sets-registry.ts`) — see Deviations #4 |

`docs/ipc-protocol.md` itself (work item 7's deliverable) is the wire-protocol reference;
`wi7-ipc-protocol-conformance-passing.txt` is its own additive-only-within-a-major-version
conformance test (`protocol/wire-schema-golden.test.ts`), diffing a live, introspected
descriptor of every wire-message schema's field set against the byte-committed golden file
`packages/supervisor/schemas/wire-protocol.v1.json`; one of its three tests directly
constructs a drifted schema to prove the mechanism itself actually catches an undocumented
field addition, not merely that the current state happens to match.

## Additional work-item evidence (not a named exit criterion, but part of the roadmap's own Test plan)

| What | Evidence file |
| --- | --- |
| WI1 — runtime dir/socket hardened-permission RED/GREEN | `wi1-runtime-dir-perms-failing.txt` (naive `mkdir`/`bind` with no explicit `chmod` — genuine `0755`/`0777`/`0755` vs. required `0700`/`0700`/`0600` assertion failures), `wi1-runtime-dir-perms-passing.txt` |
| WI1 — protocol codec (ndjson framing, handshake version negotiation) | `wi1-protocol-codec-passing.txt` (wire-schema round-trips, ndjson encode/decode, pure line-framer, handshake version match/mismatch — 25 tests) |
| WI2 — contract-typed router mechanics (register/dispatch/duplicate/unknown-op/param-and-result-schema validation) | `wi2-router-passing.txt` |
| WI2 — randomized peer-uid sequences (fast-check, 1000 runs) | `wi2-peer-auth-property-passing.txt` |
| WI3 — empty-registry-returns-empty RED/GREEN | `wi3-empty-registry-failing.txt` (naive stub throws `"registry: empty"` on `list()`/`query()` against a freshly-created registry — genuine assertion failures), `wi3-empty-registry-passing.txt` |
| WI3 — full registries suite (typed wrappers, recovery wiring against a real `@eo/journal` `JournalStore`, including the genuine-restart orphan-reconstruction case with NO pre-existing `WorkersRegistry` entry) | `wi3-registries-passing.txt` |
| WI5 — adjudication bus fail-closed-on-bridge-failure RED/GREEN | `wi5-adjudication-bus-failing.txt` (naive stub resolves a throwing policy to `allow` — genuine `allow` vs. expected `deny` assertion failure), `wi5-adjudication-bus-passing.txt` (throw, timeout, and non-Error-rejection bridge failures all resolve to `deny`) |
| WI5 — run-lifecycle transition surface (validate-before-journal ordering) | `wi5-run-transition-passing.txt` |

## Exit-criteria package gate

`exit-criteria-package-gate.txt` — captured last, after every work item above landed:
`npx tsc -b packages/supervisor` clean; `npx vitest run --coverage.enabled=false
packages/supervisor` green (**32 test files, 147 tests**); `npx eslint packages/supervisor
--ignore-pattern 'spikes/**'` clean; `npx prettier --check` clean; and a coverage run scoped
to `packages/supervisor/src/**/*.ts` (the repo's root `vitest.config.ts` coverage-include
pattern spans every workspace package, so an unscoped run dilutes the percentage with
untouched sibling-package source — see Deviations #5): **96.44% statements / 84.31% branches /
98.5% functions / 97.92% lines**, all above the ground rule's 80% line+branch bar.

## Worker provenance

One worker (this session) built the entire `packages/supervisor` deliverable — all 7 work
items, all 7 exit criteria, `docs/ipc-protocol.md`, and this evidence directory — in a single
continuous TDD pass. No parallel workers, no integration-pass reconciliation.

## Deviations

1. **`tsconfig.json` needed an explicit `"types": ["node"]` compiler option — the only
   workspace package that does.** `contracts`/`journal`/`engine-core`/`testkit` all rely on
   TypeScript's default ambient-`@types` auto-discovery successfully (verified: each builds
   clean via `npx tsc -b <package> --clean && npx tsc -b <package>` with zero errors, no
   explicit `types` field). `packages/supervisor`'s own clean rebuild, with a structurally
   identical `tsconfig.json` (same `extends`, same `compilerOptions` keys, same `include`),
   failed with dozens of `TS2591 Cannot find name 'node:fs/promises'` / `TS2304 Cannot find
   name 'process'`/`'Buffer'`/`'setTimeout'` errors across every file that imports a `node:*`
   builtin or uses a Node global — despite `@types/node` being present and resolvable at
   `node_modules/@types/node` (confirmed via `--traceResolution`: `@types/node`'s
   `package.json` IS found and used for `vitest`/`vite`'s own peer-dependency type
   resolution, just never auto-included as this package's own ambient global set). The root
   cause was not conclusively isolated within this session's time budget — the four sibling
   packages' own tsconfigs are byte-for-byte structurally identical, and the failure was
   reproducible across repeated clean rebuilds (not a one-off transient). Adding the explicit
   `"types": ["node"]` override resolved it completely (verified: `npx tsc -b
   packages/supervisor` clean afterward, with zero other regressions across the other 4
   packages, whose own tsconfigs were left untouched). This is a narrowly-scoped, safe,
   arguably-more-correct-anyway fix (explicit ambient-type intent instead of relying on
   fragile auto-discovery) rather than a workaround masking a real logic bug — flagged here
   for whoever investigates the repo's tsconfig/project-reference graph next, since it may
   indicate a real (if currently harmless) fragility in how `tsc -b`'s auto-discovery
   interacts with a 4-deep project-reference graph specifically.

2. **The real `SO_PEERCRED` reader shells out to a short-lived `python3` subprocess, passing
   the accepted connection's own raw fd via Node's documented `stdio` array fd-passing
   mechanism (`peer-auth/peer-credentials.ts`).** Node's `net` module exposes no
   `getsockopt` binding of its own, and there is no pure-JS way to read a UNIX-domain peer's
   kernel-enforced credentials (`/proc/self/fdinfo/<fd>` was checked directly and carries no
   peer-identity field on this kernel). The textbook fix is a native (N-API) addon, which
   needs `node-gyp` + a build step normally installed via `npm install` — explicitly
   forbidden this phase. `python3`'s own `socket` stdlib module already wraps the genuine
   kernel `getsockopt(SOL_SOCKET, SO_PEERCRED)` syscall; handing it the dup()'d fd (verified
   empirically, before this module was written, that dup()ing via `stdio: [...,fd]` leaves
   the parent's own fd — and the live socket — completely unaffected) reads the real
   credential with zero new npm dependencies. This is a genuine architectural compromise, not
   a mock: `peer-credentials.test.ts`'s first test exercises this exact mechanism end-to-end
   over a real, self-connected UDS socket and asserts it reads back this process's own real
   `process.getuid()`/`process.pid`. The real risk this introduces: **`python3` must be
   present on the host** for this code path to succeed — verified present in this dev/CI
   environment, but not a universal guarantee for every future deployment target. The
   fail-closed posture (`PeerCredentialUnavailableError` on ANY bridge failure, including a
   missing `python3` binary — `child.on("error", ...)`) means a host without `python3` fails
   SAFE (every connection refused) rather than open, but it does mean the supervisor would be
   entirely non-functional on such a host. Flagged for 06/09/23 (whoever owns the eventual
   deployment/packaging story) to weigh a native-addon rewrite once `npm install` is
   permitted in a later phase.

3. **`termination-ladder.test.ts`'s "forced escalation" (SIGKILL-equivalent) test uses a
   hand-rolled, deliberately non-cooperative `EngineAdapter` double, not
   `@eo/testkit`'s `FakeEngineAdapter`.** `FakeEngineAdapter.cancel()` always cooperates —
   its own `hang` failure mode reliably unblocks the instant `cancel()` is called (the
   hang-gate opens synchronously) — so a test built only against it can only ever exercise
   the GRACEFUL path, never prove the ladder's forced-abandonment step actually protects
   against an adapter that fails to honor its own `cancel(handle, deadline)` contract. The
   real fake engine IS still used, in a second test in the same file, to prove the graceful
   path. A related, genuine correctness finding surfaced while building this: an async
   generator's `.return()` cannot interrupt code currently suspended on a `await` that will
   never itself resolve (verified directly — an early draft of `terminateWorker`'s forced
   step `await`ed `iterator.return()` and the whole test hung past its outer timeout).
   `terminateWorker`'s real, shipped implementation fires `iterator.return()` but
   deliberately does NOT await it — "forced" means the supervisor gives up waiting on this
   worker from its own side (proven by the bounded `graceMs` + the function's own promise
   resolving), independent of whether the underlying, misbehaving generator ever actually
   completes. This is documented in `termination-ladder.ts`'s own step-3 doc comment and in
   the test's own comments.

4. **The Gap 1 (`change_set.*` ban) grep-based conformance scanner caught two of this
   package's own doc comments during development**, both fixed before this evidence was
   captured: `router/operations.ts`'s file-level doc comment and
   `registries/change-sets-registry.ts`'s file-level doc comment both originally quoted the
   banned literal verbatim while explaining that no such operation exists — the same
   self-referential trap phase-02's own evidence records for its `"eo_gateway"`
   sole-definition-site scanner. Both were rephrased to describe the deleted family without
   spelling out the literal dotted form; the scanner is intentionally a raw-text `.split()`,
   not AST-aware, so it can't be told "this mention is just prose."

5. **Coverage is reported scoped to `packages/supervisor/src/**/*.ts`, not via the bare
   root `vitest run --coverage packages/supervisor` invocation.** The repo-root
   `vitest.config.ts`'s `coverage.include` is `packages/*/src/**/*.ts` — repo-wide by
   design (phase 01's own choice, not something this phase may edit). Running coverage
   scoped only to `packages/supervisor`'s own TEST FILES still measures against every
   workspace package's source tree; since only supervisor's own tests execute in that
   invocation, every OTHER package's modules (imported as real, un-mocked dependencies —
   `@eo/journal`, `@eo/contracts`, `@eo/engine-core`, `@eo/testkit`) report 0% because
   their own dedicated test suites never ran, dragging the aggregate down to ~17%
   regardless of this package's own real coverage. `exit-criteria-package-gate.txt`
   therefore also captures a second run with an explicit `--coverage.include` override
   scoped to exactly `packages/supervisor/src/**/*.ts` (excluding `dist/`, `*.test.ts`,
   `*.d.ts`, `test-support/`, `*.config.*`) — this is the number this package's own ≥80%
   line+branch ground rule is actually evaluated against: 96.44%/84.31%/98.5%/97.92%.

6. **The idle-budget/`packages/perf` tension (roadmap/05 §Risks, flagged not resolved
   there) is followed exactly as written**: the idle-resource-budget probe
   (`idle-budget/resource-probe.ts`, `idle-budget/heartbeat-scheduler.ts`) is this phase's
   own, fully self-contained measurement of its own process alone
   (`process.memoryUsage()`/`process.resourceUsage()` only — no child-process spawning, no
   A/B twin-worktree harness, no dependency on `packages/perf` whatsoever), matching 15's
   own twice-stated text that this measurement is "owned end-to-end by 05... and re-measured
   directly by 23; not a `PerformanceContract`, never routed through `packages/perf`." No
   `packages/perf` import appears anywhere in `packages/supervisor/src`.

7. **`peer-credentials.ts` was refactored mid-build to extract `spawnAndParseJsonLine<T>`
   as its own separately-exported, separately-unit-testable function**, once it became clear
   the original monolithic `readPeerCredentialsLinux` couldn't have its timeout/non-zero-
   exit/malformed-output failure branches exercised without depending on `python3`'s own
   specific negative-path behavior (fragile and slow). The extracted function is generic
   over `command`/`args`/`fd`/`timeoutMs` and is tested directly against trivial, always-
   available `node -e` fixtures (`spawn-and-parse-json-line.test.ts`) — `python3` is used
   only for the one real end-to-end SO_PEERCRED integration test.

8. **The idle-budget property/timing-based property test's original per-push latency bound
   (50ms, checked on every individual `push()` call) was genuinely flaky** on this shared/
   noisy host — a single OS-scheduler or GC-pause outlier among up to 200 pushes per fast-
   check run occasionally exceeded it, observed directly during this session's own final gate
   capture. Fixed by averaging elapsed time across the whole action sequence (bound: 25ms
   average per push) rather than a strict per-call cap — this still cleanly distinguishes
   genuine backpressure-induced blocking (the naive PassThrough-stream stub this replaced
   stalls by multiple hundreds of milliseconds to unbounded, not borderline single-digit-
   millisecond noise) while absorbing incidental scheduling jitter. Re-ran 3× consecutively
   after the fix with zero further flakes.

9. **A concurrent, unrelated process was observed creating/modifying a stray
   `packages/_bisect_pkg` workspace directory during this session** (name suggests some kind
   of external bisection/verification tooling, not part of this phase's own work) — it
   transiently lacked a `package.json`, once causing a `tsc -b`/`vitest` config-load error
   unrelated to this phase's own code. Not touched, not investigated further (out of this
   phase's scope and ownership); retrying the identical command after a brief moment always
   succeeded. Flagged here only as an environmental observation in case it recurs for a
   downstream phase's own worker.

## Hardening pass (2026-07-18) — validator-raised MINOR/NOTE items

Two independent Opus validators PASSED this phase's exit criteria (all 7 met, no
CRITICAL/MAJOR findings) and raised three smaller items. Two were fixed here; the third is
a carry-forward, documented below and deliberately **not** fixed in this phase.

- **F1 (MINOR, test quality)** — the "drops surfaced, never silent" guarantee
  (`event-bus/ring-buffer.ts`'s `poll()`) was only weakly test-guarded: `ring-buffer-
  drops.test.ts` asserted `toBe(0)`/`toBeGreaterThan(0)`, and the property test's oracle
  was only `Number.isInteger(drops) && drops>=0` — both satisfied by a mutant that
  replaces the real arithmetic (`drops += oldestSeq - 1 - cursor`, ~line 87) with a
  constant `drops += 1`. Fixed by adding a deterministic EXACT drop-count test and an
  independent, brute-force-loop-counted reference model wired into both property tests
  (exact match + a `dropped + survived === pushed` accounting invariant), replacing the
  weak oracles. Mutant-kill proof: `fix-dropcount-mutant-killed.txt` (RED — all three
  strengthened assertions independently catch the mutant) and
  `fix-dropcount-mutant-restored.txt` (GREEN — real arithmetic restored, 148/148 green).
- **F2 (NOTE, robustness)** — the ndjson line-reading path had no bound on a single
  unframed line's size: an admitted (same-uid, already-trusted) peer sending a
  newline-less multi-GB stream would buffer without limit and could OOM the host. This
  applied to BOTH the pure `protocol/line-framer.ts` module and, more importantly, the
  real production connection handler in `socket/uds-server.ts`, which read lines via
  Node's `readline.createInterface` directly — bypassing `line-framer.ts` entirely and
  carrying the identical unbounded-buffering flaw. Fixed by adding a `MAX_LINE_BYTES`
  cap (1 MiB — matches the ring buffer's own `RING_BUFFER_CAPACITY_BYTES` scale;
  documented in `line-framer.ts`'s own doc comment) to `createLineFramer`, throwing a
  typed `LineTooLongError`, and rewiring `uds-server.ts` to read the real socket through
  this same capped framer (`frameSocketLines`, replacing the direct `readline` usage)
  so the cap is enforced on the actual live connection path, not just in a unit test
  against previously-dead code. Verified genuinely RED-before-GREEN by temporarily
  disabling the cap check and confirming `uds-server.test.ts`'s new "disconnects an
  admitted peer that sends more than MAX_LINE_BYTES with no newline" test fails — the
  connection hangs open indefinitely (exactly the described unbounded-buffering/OOM
  risk) rather than being closed — then restoring the fix, after which the same test
  (and all others) pass. New tests: `protocol/line-framer.test.ts`'s "MAX_LINE_BYTES cap"
  describe block (6 tests: at-cap line parses, at-cap pending buffer doesn't throw,
  over-cap pending throws, cumulative-across-pushes over-cap throws, a single
  over-cap completed line throws even in one chunk, normal small lines still parse
  after the cap logic runs) and `socket/uds-server.test.ts`'s "MAX_LINE_BYTES cap on the
  real socket read path" describe block (2 tests: an over-cap newline-less peer is
  disconnected; a large-but-under-cap request still round-trips and the connection stays
  alive for a follow-up request — confirming the handshake and normal request loop are
  unaffected).
- **F3 (carry-forward for phase 06 — documented only, not fixed here)** — see the
  dedicated section immediately below.

## Carry-forward for phase 06: `session_assignment` is journaled after `adapter.spawn()`

An adversarial validator observed that `worker-lifecycle-manager.ts`'s `spawnManagedWorker`
calls `options.adapter.spawn(...)` at line 63 and only journals `session_assignment`
afterward, at line 71 — nominally contradicting the roadmap's framing of `session_assignment`
as journaled "before a worker process starts" (roadmap/05-supervisor-daemon.md §Journal
writes this phase triggers).

This ordering is **inherent to 03's frozen `EngineAdapter` contract, not a bug introduced by
this phase**: the engine-assigned `sessionId` this package journals
(`handle.sessionRef.sessionId`) does not exist until `spawn()` itself returns — there is no
`sessionId` value available to journal any earlier than that, given 03's interface shape as
frozen. `spawnManagedWorker`'s own doc comment already states this directly: "Journal
session_assignment BEFORE consuming any events off the handle — the earliest point available
to this package (spawn() itself must return before the sessionRef is known here at all)." The
implementation already journals at the earliest point structurally possible under the current
contract.

It is also **harmless in phase 05 specifically**: this phase spawns exclusively against
`packages/testkit`'s fake `EngineAdapter`, which spawns no real OS process — there is nothing
for a crash between "spawn" and "journal" to leak.

**This will NOT be harmless once phase 06 lands a real SDK subprocess.** A crash (kill -9,
OOM-kill, host reboot) landing between a real `adapter.spawn()` call and the
`session_assignment` entry's fsync would leak a real, running, untracked worker process that
`recover(runId)` cannot discover or reap — the journal simply has no record that it was ever
started. Phase 06 (or whichever phase first spawns a real subprocess against this call site)
must address this before it ships with a real adapter. A true fix needs one of:

- supervisor-allocated session ids, minted by this package itself before calling `spawn()`,
  so a `session_assignment` entry can be journaled pre-spawn and `spawn()` merely confirms it
  (requires a 03 contract change: `EngineAdapter.spawn()` would need to accept a caller-supplied
  session id rather than mint its own), or
- a pre-spawn "intent" journal entry (a new journal semantics: "about to spawn for work unit
  X," reconciled or discarded on the next `recover()` pass depending on whether the spawn
  is later confirmed) — a 04/05 journal-schema question as much as a 03/06 one.

Either direction is a 03/06 concern (the `EngineAdapter` contract and/or the real spawn call
site), not something this phase's own code can resolve without either 03's interface changing
underneath it or a new journal entry type 02/04 would need to define. **Spawn/journal ordering
in `worker-lifecycle-manager.ts` is deliberately left unchanged by this hardening pass** — this
section is documentation of a known, understood, and currently-inert gap for phase 06 to pick
up, not a fix.
