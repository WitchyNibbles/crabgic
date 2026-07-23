# Phase-06 security hardening (WI6) — adversarial-audit fix record

Fixes for the 5 findings an adversarial Opus audit raised on `packages/engine-claude`'s
independent-backstop and assurance surfaces. The static enforcement core (baseline §3
allow/deny + OS sandbox) was found SOLID and is unchanged. Every fix is RED-first where
behavioral; every engine fact cites `docs/engine-baseline.md` (accepted range engine
2.1.207–2.1.210 / SDK 0.3.207–0.3.210, tested 2.1.210/0.3.210), never memory.

Verification (all from repo root): `npx tsc -b` exit 0; `npx vitest run --project
@eo/engine-claude --coverage.enabled=false` → 284 passed (pre-existing 271 held, no
regression); coverage ≥80% line AND branch on every touched module (table below);
`npx vitest run --project @eo/contracts -t "sole"` → 1 passed; `node
scripts/check-engine-pin.mjs` → PASS; `npm run format` exit 0; `npx eslint
packages/engine-claude/src` clean; goldens byte-golden test green (Finding 4 did not
perturb valid-input output); the new live probe fails-fast RED without `EO_LIVE`
(Test Files: 1 failed — `beforeAll` throws `LiveEnvNotEnabledError`, not skip-green).

Coverage (touched modules, from the `@eo/engine-claude` coverage run):

| Module                   | % Lines          | % Branch         |
| ------------------------ | ---------------- | ---------------- |
| `adapter.ts`             | 98.40            | 93.87            |
| `adjudication-policy.ts` | 95.71            | 92.72            |
| `event-normalizer.ts`    | 100              | 99.20            |
| `hooks.ts`               | 96.42            | 93.02            |
| `options-assembler.ts`   | 100              | 97.36            |
| `auth.ts`                | 100 (lcov 21/21) | 100 (lcov 2/2)   |
| `limit-signal.ts`        | 100 (lcov 49/49) | 100 (lcov 65/65) |

(`auth.ts`/`limit-signal.ts` are hidden by the text reporter's `skipFull` because they are
100% — confirmed directly from `coverage/lcov.info`.)

---

## Finding 2 — MAJOR: PostToolUse audit false-aborted every worker if `canUseTool` never fired under `dontAsk`

**Files:** `src/hooks.ts`, `src/adapter.ts`, `src/hooks.test.ts`, `src/adapter.test.ts`,
new `src/live/adjudication-bridge.live.test.ts`, `README.md`.

**Root cause.** `hooks.ts` recorded a violation whenever `hasMatchingAllowedDecision` was
false — including when the audit log had ZERO records for the tool. `recordAllowedDecision`
is only called after the `canUseTool` bridge resolves an `allow`. Whether the SDK invokes
`canUseTool` at all under `permissionMode: "dontAsk"` is an UNPROBED engine fact
(baseline §3 probed enforcement via the static allow/deny lists + `result.permission_denials`,
with NO `canUseTool` installed). If it never fires, the audit log stays empty and the first
pre-approved tool → violation → the adapter aborts EVERY worker.

**RED (captured against pre-fix code, `src/hooks.test.ts`):** 3 tests failed —

```
× does NOT record a violation for a tool with ZERO adjudicated records ...
    178|     expect(audit.violations).toHaveLength(0);      // actual: 1
× hasAnyAllowedDecision is false before anything is recorded, true once a decision is recorded
    TypeError: audit.hasAnyAllowedDecision is not a function
× records an internal audit FAILURE (not a violation) when the audit machinery throws ...
```

**Fix.**

1. **Audit-contract change (verbatim new wording).** The audit "detects a tool that WAS
   adjudicated (≥1 allow recorded for that tool name) but whose EXECUTED input matches none
   of those adjudicated inputs — a genuine adjudicated-vs-executed MISMATCH. A tool with
   ZERO adjudicated records executed under STATIC dontAsk allow-list authorization is OUT OF
   the audit's scope, NOT a violation." Added `hasAnyAllowedDecision(toolName)` to the
   `AdjudicationAuditLog` interface + in-memory impl. The hook's violation condition is now
   `hasAnyAllowedDecision(tool_name) && !hasMatchingAllowedDecision(tool_name, tool_input)`.
   The interface `AUDIT CONTRACT` + `KEYING LIMITATION` doc comments were rewritten to state
   this precisely.
2. **Internal-error handling.** The catch-block still records for visibility, but now into a
   NEW separate channel `recordAuditFailure`/`auditFailures` (typed `AdjudicationAuditFailure`)
   — NOT `violations`. Documented choice: a broken audit log is a diagnostic concern, not
   evidence of a compromised tool call; recording it as a violation would abort the worker on
   a mere hook bug and conflate "the audit code broke" with "the engine executed a mutated
   input". The load-bearing static allow/deny enforcement (baseline §3) is unaffected by a
   broken audit log, so declining to abort here is the correct, non-fail-open choice.
3. **Adapter abort path (fix #3).** `AdjudicationAuditViolationError`'s doc comment now states
   that reaching the abort path always means a genuine adjudicated-vs-executed mismatch — a
   zero-record tool never lands there, and an internal error is an `auditFailure`, not a
   violation — so a REAL mismatch abort is not weakened.
4. **New live probe** `src/live/adjudication-bridge.live.test.ts` — installs the REAL
   `ClaudeEngineAdapter` (default SDK `query`), a REAL `createAdjudicationBus`-backed policy
   (05's journal-teed bus wrapping `createEnvelopeAdjudicationPolicy` with substituted
   permissions), and the harness's temp-dir `JournalStore`; `git init`s the worktree; drives
   ONE genuinely-allowed cheap tool `Bash(git status:*)` (which the standard-implementation
   envelope allows) to completion. It asserts **(a)** the worker does NOT audit-abort (no
   `AdjudicationAuditViolationError`) and the git-status `toolUse` was emitted (executed-call
   guard), and **(b)** EMPIRICALLY records WHETHER `canUseTool` fired — an
   `adjudication_decision` journal entry appears iff the bus/bridge was invoked; whichever way
   the unprobed fact resolves, every recorded decision for the allowed call must be an `allow`.
   Like every `*.live.test.ts` it fails RED without `EO_LIVE` (`assertLiveEnabled()` in
   `beforeAll`), verified: `Test Files 1 failed`, `LiveEnvNotEnabledError`, not skip-green.
5. **Guarantee downgrade** (README decision 12 + below): the per-call adjudication-JOURNALING
   backstop is LIVE-UNVERIFIED because `canUseTool`-under-`dontAsk` is unprobed. Carry-forward.

**GREEN.** `src/hooks.test.ts` + `src/adapter.test.ts` → 49 passed (incl. the existing
adapter abort test at `adapter.test.ts:349`, which records an allow for `Read{file_path:"a"}`
then a PostToolUse with `{file_path:"MISMATCH"}` → still a genuine mismatch → still aborts).

**GUARANTEE DOWNGRADE WORDING (README decision 12, verbatim addition):** "the independent
per-call adjudication-**journaling** backstop … is **LIVE-UNVERIFIED**, because whether the
SDK invokes `canUseTool` at all under `permissionMode: "dontAsk"` is an **unprobed engine
fact** — baseline §3 probed enforcement via the static allow/deny lists +
`result.permission_denials`, with **no `canUseTool` installed**. The **load-bearing,
verified** enforcement layer is the static `dontAsk` allow/deny + OS sandbox (baseline §3),
which holds regardless. … Owed: a baseline §3 addendum probing `canUseTool`-under-`dontAsk`;
the new `src/live/adjudication-bridge.live.test.ts` probe converts this into a live-gated
assertion."

---

## Finding 3 — MINOR: home-suffix widening applied to ALLOW rules (latent false-ALLOW)

**Files:** `src/adjudication-policy.ts`, `src/adjudication-policy.test.ts`.

**Root cause.** `matchesAnchoredGlob` (called for both allow and deny) applied the
`home`-bucket→`absolute`-target widening `absoluteTargetContainsHomeSuffix` (segment window
anywhere in the path) unconditionally — a safe false-DENY for deny rules but a false-ALLOW
for allow rules (allow `Read(~/.config/**)` would match `/tmp/.config/evil`). Currently
unreachable (the compiler emits `~/` only in deny), but this policy is an INDEPENDENT
backstop that must not assume the compiler's shape (baseline §3).

**RED (`src/adjudication-policy.test.ts`):**

```
× an allow-only '~/'-anchored rule does NOT widen to an absolute target sharing only a mid-path segment
   policy(Read, {file_path:"/tmp/.config/evil"}) with allow ["Read(~/.config/**)"]
   expected "deny" — pre-fix returned "allow"
```

**Fix.** Threaded a `RuleContext = "allow" | "deny"` flag through `matchesToolPathRule` →
`matchesAnchoredGlob`; the home→absolute widening is applied ONLY when `context === "deny"`.
In allow context a home-bucket rule vs. an absolute target is NO match. `evaluateToolCall`
passes `"deny"` for deny-rule checks and `"allow"` for allow-rule checks.

The cross-model property test (`verdict agreement with @eo/testkit`) deliberately EXCLUDES
this one family via `fc.pre(!(ruleAnchor === "~/" && targetAnchor === "/" && inAllow &&
!inDeny))` — a documented divergence (testkit's `matchesAnchoredGlobLiteral` widens
symmetrically; this policy widens deny-only, which is strictly safer). The deny-side widening
and the allow-side non-match are covered by dedicated example tests. The existing "allows a
Read elsewhere" test was updated to use a `/`-anchored allow (which legitimately matches
absolute targets) so it still asserts allow, exercising the deny-side widening FALSE branch.

**GREEN.** `src/adjudication-policy.test.ts` → 37 passed (incl. the 2000/3000-run property tests).

---

## Finding 4 — MINOR: `worktreePath`/`workerTmp` under-validated (substitution corruption / root-write)

**Files:** `src/options-assembler.ts`, `src/options-assembler.test.ts` (+ `session.test.ts`
generator update).

**Root cause.** `assertSafeAbsolutePath` blocked non-absolute/`..`/`~`/glob metachars but NOT
`<`/`>` nor the placeholder tokens, and substitution ran the two replacements SEQUENTIALLY —
so a `worktreePath` like `/valid/<worker-tmp>/wt` had its injected token expanded by the
second pass (scope corruption); also `worktreePath="/"` passed (root-write).

**RED (`src/options-assembler.test.ts`):** 5 tests failed — `<worker-tmp>`-bearing
worktreePath NOT rejected; `<`/`>` in workerTmp NOT rejected; `/` NOT rejected; `/x` NOT
rejected; `/tmp` (single segment) NOT rejected.

**Fix (without changing the `//`→`///` anchor output for valid inputs).**
(a) reject any value containing `<` or `>` (this subsumes the literal `<worktree>`/`<worker-tmp>`
tokens) → `PlaceholderSubstitutionError`; (b) enforce a minimum depth of ≥2 non-empty path
segments so `/` and `/x` are rejected; (c) a SINGLE simultaneous substitution pass —
`buildSinglePassSubstituter` builds one `/<worktree>|<worker-tmp>/g` alternation and does one
`String#replace` with a per-match map lookup, so an injected token can never be expanded by a
later pass. Valid-input output is byte-identical (goldens pass; the `///fixture/worktree/`
anchor regression test asserts it directly). The `session.test.ts` fast-check generator and
its decoy config were updated to produce ≥2-segment paths (a real worktree is always deeper
than root; `/A`/`/decoy-tmp` were synthetic).

**GREEN.** `src/options-assembler.test.ts` → 43 passed, incl. `*.sdk-call.json` byte-golden
tests for all three canonical envelopes. Full-suite golden test green.

---

## Finding 5 — MINOR: `.credentials.json` copy followed a destination symlink (credential TOCTOU)

**Files:** `src/auth.ts`, `src/auth.test.ts`.

**Root cause.** `copyFile` (no `COPYFILE_EXCL`) opens the dest `O_WRONLY|O_CREAT|O_TRUNC`,
following symlinks — a pre-planted symlink at `<configDir>/.credentials.json` would leak the
owner's real subscription credentials (baseline §1's confirmed `.credentials.json` fallback)
through it.

**RED (`src/auth.test.ts`):** 2 tests failed — a pre-planted symlink at the dest was
followed/written (not refused); a pre-existing regular file at the dest was overwritten (not
refused).

**Fix.** Read the source bytes, then write the dest via an exclusive, no-follow create:
`fs.open(destPath, O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW, 0o600)`, `writeFile(bytes)`,
`fchmod(0600)`, `close` in `finally`. A pre-existing dest (`EEXIST`) or a symlinked dest
(`ELOOP`) is REFUSED with the existing typed `WorkerAuthError` whose static message contains
no credential bytes/token (secret-safe error discipline preserved and asserted). The symlink
target is never written (no follow).

**GREEN.** `src/auth.test.ts` → 8 passed, incl. the happy path (clean dest → 0600
byte-identical copy) and the two new refusal tests (symlink target left byte-identical; the
dest is still the symlink).

---

## Finding 6 — MINOR: error-string limit detector fired on model-authored assistant text (prompt-injectable)

**Files:** `src/event-normalizer.ts`, `src/limit-signal.ts`, `src/event-normalizer.test.ts`,
`src/limit-signal.test.ts`.

**Root cause.** `normalizeSdkStream` ran `detectLimitErrorString` over assistant prose (and a
success result's model-authored `result` text). A worker induced to emit "you've hit your
rate limit, resets tomorrow" would synthesize a spurious `status:"rejected"` limitSignal → a
park/stall (attacker-triggerable, fail-safe but a stall).

**RED (`src/event-normalizer.test.ts`):**

```
× does NOT synthesize a limitSignal for model-authored ASSISTANT text carrying the limit phrase
   normalizeSdkStream([assistant text = baseline §8 sample]) — pre-fix also yielded a rejected limitSignal
```

(The companion "DOES synthesize for an ENGINE error result" test passed pre-fix, confirming
the engine channel was preserved end-to-end.)

**Fix.** The detector now runs ONLY over engine-originated error text — a non-success
`result` message's own `errors` array (`if (message.type === "result" && message.subtype !==
"success")`). It is NEVER run over model-authored text: not `assistant` prose, and not a
SUCCESS result's `result` field. This is the only shape an actual exhaustion has been
observed to surface as (baseline §8: "Agent terminated early due to an API error: You've hit
your session limit · resets 2:10pm (Europe/Madrid)"). Doc comments in both modules updated.

**GREEN.** `src/event-normalizer.test.ts` + `src/limit-signal.test.ts` → 78 passed, incl. the
new assistant-text-no-synth, engine-error-result-synth, and benign-engine-error tests.

---

## Carry-forwards (for the reconcile / live-run)

- **Engine-fact-drift (Finding 2):** `canUseTool`-under-`permissionMode:"dontAsk"` is an
  unprobed engine fact. Owed: a baseline §3 addendum; the new
  `src/live/adjudication-bridge.live.test.ts` probe closes it when the `@live` suite runs.
- No baseline, goldens, or the `//`→`///` substitution output were changed (Finding 4 added
  input validation + a single-pass substituter only; valid-input output is byte-identical).
