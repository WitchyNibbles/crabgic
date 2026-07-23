# Phase 06 — pre-commit adversarial validation round

Two independent adversarial reviewers were run against the uncommitted Phase 06
implementation (the 13 `packages/engine-claude/src/*.ts` modules, tests excluded)
immediately before the phase's first commit to `main`, because the phase changes the
attack surface (auth injection, the real `AdjudicationCallback`, sandbox/hermeticity).
This file records what they found, what was fixed, and what is carried forward.

## Reviewers

- **Security pass** — invariant-by-invariant check of the 7 spec-mandated security
  invariants (fail-closed adjudication + journal-first, auth confinement, env allowlist,
  `settingSources: []`, no hand-typed `eo_gateway`, no blanket `mcp__*` deny, version-gate
  ordering). Also re-verified the 5 previously-fixed `wi6` findings are present and
  non-regressed in the current file contents.
- **TypeScript correctness pass** — manual trace for async/await races, error swallowing,
  resource leaks, boundary bugs, and immutability violations the passing suite misses.

## CONFIRMED CRITICAL — FIXED

**`resume()`/`fork()` crashed permanently on the `credentialsFile` auth path.**

`buildHandle`'s generator calls `provisionWorkerAuth(config.auth, params.sessionRef.configDir)`
unconditionally on every `spawn`/`resume`/`fork` (`adapter.ts`). `provisionWorkerAuth` opened
the destination `.credentials.json` with `O_CREAT|O_EXCL|O_NOFOLLOW` (`auth.ts`), which throws
`WorkerAuthError` the moment the file already exists. Because 05 keys the per-worker
`CLAUDE_CONFIG_DIR` by a stable `workerId`, a `resume`/`fork` lands on the exact directory the
original `spawn` already provisioned — so the very first pulled event of any `credentialsFile`
recovery threw, indistinguishable from an ordinary crash, i.e. a permanent crash-loop for the
confirmed-PASS fallback mechanism (`docs/engine-baseline.md` §1). This directly contradicted
exit criterion `crash-recovery.live.test` ("kill -9 → resume continues... context intact").

It was invisible to the suite because every adapter/crash/session test built its config with
`auth: { kind: "oauthToken" }`, which short-circuits before any filesystem write; `auth.test.ts`
only exercised `provisionWorkerAuth` once per dir, never the spawn→resume double-provision.

**Fix (`auth.ts`):** `provisionWorkerAuth` is now idempotent for the `credentialsFile` path. It
inspects an already-present destination WITHOUT following symlinks (`O_RDONLY|O_NOFOLLOW`):
- dest absent (`ENOENT`) → exclusive no-follow create, exactly as before (first spawn);
- dest is a regular file whose bytes equal the source → accept as-is, no rewrite (resume/fork);
- dest bytes differ → refuse as tampering, never overwrite;
- dest is a symlink / non-regular → refused, never followed.

This preserves the `wi6` Finding-5 hardening (a pre-planted symlink is still refused, now on the
resume read path too) while making recovery on `credentialsFile` auth succeed.

**Tests added (RED→GREEN):**
- `auth.test.ts` — split the over-broad "REFUSES a pre-existing regular file" case into
  (a) idempotent-accept on byte-identical dest and (b) refuse on byte-mismatched dest.
- `crash-recovery.test.ts` — end-to-end `spawn(credentialsFile)` into a real temp
  `CLAUDE_CONFIG_DIR`, then `resume`, asserting the recovery generator resolves (yields a
  `result`) instead of rejecting with `WorkerAuthError`.

Full repo gate after the fix: `tsc -b` clean; **1576** tests / 167 files green; coverage
threshold met; eslint + prettier clean.

## Also fixed

- **Doc-comment ordering (correctness of documentation, `adapter.ts`).** The `session_assignment`
  comment claimed 05 appends its own entry only *after* consuming the first pulled event; 05
  actually appends synchronously right after `spawn()` returns, before building the iterator, so
  05's entry lands first. Comment corrected; the load-bearing invariant (this generator's own
  append precedes its own `sdkQueryFn` call) was never in doubt, and duplicate entries are
  tolerated (`recovery.ts` tracks the latest per session).

## Carry-forward (NOT fixed here — deliberate)

1. **Bash compound-command splitting is quote-unaware (MEDIUM, fails SAFE).**
   `splitCompoundCommand`/`decomposeBashCommand` (`adjudication-policy.ts`) split on bare
   `;`/`|`/`&&`/`||` with no shell-quoting awareness, so an allowed command whose *quoted
   argument* contains an operator (e.g. `git commit -m "fix; typo"`) is over-split and
   false-DENIED. Confirmed by trace to fail only in the safe direction (over-denial adds
   segments that must each independently match; it never merges/hides a real separator), so it
   is a reliability defect, not a privilege-escalation bypass. A correct fix needs a
   quote/escape-aware tokenizer; a hasty partial fix risks mis-tracking quote state and MERGING a
   real separator (which *would* be a security hole), so it is deferred rather than rushed into
   this commit. Untested (the property test never generates a quoted operator).

2. **No production composition root yet wires the real policy through the journal-teed bus
   (MEDIUM, architectural — out of Phase 06 scope).** `createEnvelopeAdjudicationPolicy` is
   called only from tests; `spawn`/`resume`/`fork` correctly accept `adjudicate` as an injected
   dependency, so nothing in these files can itself skip the bus — but nothing enforces that a
   future integrator wraps the policy in `createAdjudicationBus` before handing it to `spawn`.
   Both shapes are structurally compatible, so an unwrapped policy would type-check and still
   fail closed, but the "journal `adjudication_decision` before it takes effect" half of the
   invariant would silently never fire. Recommend a branded return type from
   `createAdjudicationBus` (or a runtime assertion in the adapter). Flagged for the reconciler /
   whichever phase owns the composition root (05/13 wiring).

3. **Cross-process resume inherits the resuming adapter instance's `HOME`/`TMP` (LOW).**
   `buildHandle` scopes the security-sensitive `CLAUDE_CONFIG_DIR` to the session's own
   `sessionRef.configDir` (safe — no credential leak), but `HOME`/`TMPDIR`/`TMP` come from the
   adapter instance's construction-time provisioning. If a *new* adapter instance ever resumes a
   session it didn't spawn, the resumed worker runs under mismatched `HOME`/`TMP`. Already noted
   in the adapter's own cross-process-resume carry-forward (13/05 reconciliation).

## Ruled out (checked, not defects)

Bash compound/wrapper-smuggling matching (denies by default on unproven metacharacters);
`//`/`~/`/`/`-anchored path matching incl. the post-substitution `///` anchor + `../..`
traversal; env allowlist, gateway-name reference, `settingSources` literal, version-gate
ordering; the 5 prior `wi6` fixes (audit false-abort, home-suffix false-allow,
path-substitution/root-write, credential TOCTOU, prompt-injectable limit-signal) — all
re-verified present and correct.
