# R7-P2 — Edit Pre→Post `tool_input` stability (live transcript)

<!-- prettier-ignore-start -->

```
# UPSTREAM BASE (stable — resolves for any reader, now and after merge): f985511ecdc1e3abb009498b6560a0994a665cb5
# branch tip at capture (PROVISIONAL — a pre-merge branch commit; see RULING-3): probe/r7-p2-and-plugin-smoke
# CAPTURED (UTC): 2026-08-05T15:32:32Z … 2026-08-05T15:32:50Z  (live — the only turns this probe ever spent)
#                 2026-08-05T15:36:13Z                          (zero-turn re-derivation control)
#                 2026-08-05T15:38Z … 15:39Z                    (zero-turn mutation battery)
# HOST: engine 2.1.218 (SDK-bundled binary, asserted by the harness canary), bubblewrap 0.9.0, model `sonnet`
# LOAD at capture: load average 0.31 0.25 0.16 — no contention, so no flake caveat applies
# PROBE: packages/engine-claude/src/live/edit-input-stability.live.test.ts
# ARTIFACT: docs/evidence/phase-06/edit-input-stability-determination.json
#           sha256 cf08f6098d03799040adedf4957a04233587984edc444202afa323cd72688051
#           md5    4fc204feb72892210f44abb8d48054c3   (quoted below because the mutation battery
#                  restores against it seven times; the sha256 above is the citable digest)
# BUDGET: 12 engine turns for the whole owner-authorized item, canary included, SHARED with the
#         phase-10 plugin.live-smoke run recorded in docs/evidence/phase-10/.
#         This probe spent 5 — canary 1 + arm 4 — and reserved 4 for that run.
```

<!-- prettier-ignore-end -->

**Every command below ran in a worktree checked out at the upstream base above, with
only this probe and its two evidence files added.** No file outside
`packages/engine-claude/src/live/` and `docs/evidence/` was touched. Paths are
elided as `<worktree>`; the host account name appears nowhere in this file.

---

## 0. Secrecy attestation

**Nothing sensitive was in this probe's reach, and nothing sensitive was persisted.**

- Every file the probe touched it created itself, inside an `os.tmpdir()` scratch
  worktree deleted in `finally`. Their entire content is synthetic
  `R7P2-BEFORE-<tag>` / `R7P2-AFTER-<tag>` / `R7P2-WRITE-<tag>` markers.
- No real HOME path, credential, dotfile or user file was read by any arm. The
  probe reads exactly one file it did not write: none.
- The harness's `resolveWorkerAuthMaterial` registers the resolved OAuth token as
  a live-secret before the first engine call, so the sanitization scan covers it.
  The arm's own scan over the **raw transcript** returned `secretScanHits: {}` —
  an empty object, i.e. zero hits in **every** category including `$HOME path
leak`, not merely in the categories the file asserts on.
- The persisted artifact went through `assertSanitized` before it was written.
  Independent re-check at capture: `grep -c` for the host account name in the
  artifact → `0`.
- Redaction contract, as the artifact itself records: the scratch root becomes
  `<scratch>` and the real home becomes the four-character literal text `$HOME`.
  A `~` anywhere in the artifact is therefore a REAL tilde the compiler emitted.

---

## 1. Baseline — the probe fails RED without `CRABGIC_LIVE`, before any spend

<!-- prettier-ignore-start -->

```
$ npx vitest run --config vitest.live.config.ts \
    packages/engine-claude/src/live/edit-input-stability.live.test.ts
 ❯ packages/engine-claude/src/live/edit-input-stability.live.test.ts (3 tests | 3 skipped) 5ms
LiveEnvNotEnabledError: CRABGIC_LIVE is not set to '1' — the @live conformance suite refuses to run
 Test Files  1 failed (1)
      Tests  3 skipped (3)
EXIT=1
```

<!-- prettier-ignore-end -->

Three tests declared. That count is constant in every run below — the
countermeasure against a probe that "passes" because its assertions vanished.

Two further zero-turn pre-flights, both run before any spend:

- `tsc -b` and `eslint` on the new file: clean.
- The compiled profile re-derived offline, confirming the arm would really be
  granted the tool under test: `permissions.allow` carries
  `Edit(//<worktree>/packages/example/src/**)` and its `Write` sibling, and
  `permissions.deny` has 26 entries. Had this been wrong the arm would have spent
  turns on a refusal and measured nothing.

## 2. The measurement — one arm, 4 turns

<!-- prettier-ignore-start -->

```
$ CRABGIC_LIVE=1 npx vitest run --config vitest.live.config.ts \
    packages/engine-claude/src/live/edit-input-stability.live.test.ts
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  14.47s
EXIT=0
```

<!-- prettier-ignore-end -->

Turn ledger, verbatim from the artifact: `canary 1/1`, `edit-input-stability 4/5`
— **5 spent of the 12-turn cap**, 4 of which were reserved for phase 10 and were
not spent here.

**VERDICT A — byte stability: `STABLE`.** One correlated `Edit` pair (Pre and Post
matched on the SDK's own `tool_use_id`), `JSON.stringify` identical on both sides,
including key order:

<!-- prettier-ignore-start -->

```
preKeys  = ["file_path","old_string","new_string","replace_all"]
postKeys = ["file_path","old_string","new_string","replace_all"]
byteIdentical = true   structurallyEqual = true   productionAuditViolations = 0
```

<!-- prettier-ignore-end -->

Note what that settles about the specific hazard this probe was written for:
`replace_all` — `Edit`'s one OPTIONAL member, and the obvious candidate for an
engine-injected default — is **already present at PreToolUse** (`false`) and
unchanged at PostToolUse. Whether the model emitted it or the engine defaulted it
BEFORE the hook is not distinguished by this measurement and no claim is made
either way; what matters for the audit is that both hooks saw the same thing,
because the audit compares exactly those two payloads.

**VERDICT B — production consequence: `NO-ABORT`.** Replaying the real
`createInMemoryAdjudicationAuditLog` + `createPostToolUseAuditHook` (imported
from `packages/engine-claude/src/hooks.ts`, wired as `adapter.ts` wires them)
over the captured payloads records **0** violations. A legitimate owned-path
`Edit` is not killed by `AdjudicationAuditViolationError` on this engine version.

**Controls, all in the same run:** C1 = 1 correlated `Edit` pair (executed-call
guard); C2 = the edit's effect observed on disk, pre-marker gone and post-marker
present; C3 = 1 correlated `Write` pair, byte-identical too, so the capture
machinery is falsifiable in-run and the tool is isolated had `Edit` differed.
A `Read` pair was captured incidentally and was also byte-identical.

**Incidental observation, recorded but NOT investigated and carrying no claim:**
the arm's `system/init` tool catalog has 26 entries; `Read`, `Edit`, `Write` and
`Bash` are present, and `Agent`/`WebFetch`/`WebSearch` are absent — consistent
with `MANDATORY_FIXED_DENY` and §4.2's catalog-removal channel. `Glob`, `Grep`,
`Task` and `TodoWrite` are ALSO absent while appearing in no deny rule, which
this probe does not explain. The full catalog is in the artifact for whoever
picks that up.

## 3. Restore + re-derivation control — same sha, zero turns

The arm's verdict is derived from the PERSISTED record, never from in-memory
state, so a second invocation re-derives it for free. Re-run with
`R7P2_PRIOR_TURNS=5`, which suppresses both the canary and the live arm:

<!-- prettier-ignore-start -->

```
$ CRABGIC_LIVE=1 R7P2_PRIOR_TURNS=5 npx vitest run --config vitest.live.config.ts \
    packages/engine-claude/src/live/edit-input-stability.live.test.ts
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  1.11s
EXIT=0
artifact: BYTE-IDENTICAL     spent 5     ledger [canary 1, edit-input-stability 4]
```

<!-- prettier-ignore-end -->

1.11s and no engine call: the reuse path costs nothing. This exists because a
shared cross-process cap makes a second invocation legitimate, and without the
guard that invocation would have stamped a `NOT RUN` stub over a real
measurement — the failure `read-exposure.live.test.ts` documents and guards the
same way.

## 4. Mutation battery over the verdict derivation — 6 mutations, zero turns

**Read "caught" in two senses, because they are not the same and the table below
distinguishes them.** All six mutations change the DERIVED VERDICT, which is what
makes the derivation non-vacuous. Only M3–M6 additionally turn the SUITE red; M1
and M2 move the verdict to `UNSTABLE-*` while the suite stays green, and that is
correct by design — a byte-only instability is a finding to record, not a
production failure, so the file must report it without going red.

Because the derivation is a pure function of the artifact, every mutation is
applied to the artifact and the file re-run with the arm suppressed. **Baseline
recorded in the same battery, at the same sha.** Restores use an explicit source
AND an explicit path (`git checkout HEAD -- <artifact>`); the artifact's md5 is
printed after every one.

| #   | mutation                                | derived verdict                    | suite                                                               |
| --- | --------------------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| M0  | none (baseline)                         | `STABLE` / `NO-ABORT`              | 3 passed                                                            |
| M1  | Edit pair `byteIdentical: false`        | `UNSTABLE-BYTES-ONLY` / `NO-ABORT` | 3 passed                                                            |
| M2  | also `structurallyEqual: false`         | `UNSTABLE-STRUCTURAL` / `NO-ABORT` | 3 passed                                                            |
| M3  | `productionAuditViolations: 1`          | `STABLE` / **`ABORT`**             | **1 failed** — `AssertionError: expected 'ABORT' not to be 'ABORT'` |
| M4  | drop the `Write` pair (C3)              | `INCONCLUSIVE` / `INCONCLUSIVE`    | 1 failed                                                            |
| M5  | `C2 edit effect present on disk: false` | `INCONCLUSIVE` / `INCONCLUSIVE`    | 1 failed                                                            |
| M6  | drop the `Edit` pair (C1)               | `INCONCLUSIVE` / `INCONCLUSIVE`    | 2 failed                                                            |

**M3 is the one that matters:** it proves the claim-bearing assertion
`expect(productionConsequence).not.toBe("ABORT")` can actually fail. Without it,
`NO-ABORT` would be a green light nobody had ever seen turn red. M4–M6 prove each
control is load-bearing on the verdict rather than decorative.

Test count constant at **3** in all seven runs; `spent` constant at **5** (no
mutation run spent a turn); artifact md5 back to `4fc204feb72892210f44abb8d48054c3`
after every restore, and `git status --short` clean at the end.

The audit replay's own two controls, C4 and C5, are asserted inside the probe and
not in this table: C4 feeds the real audit a MUTATED post input and requires
exactly 1 violation; C5 feeds it the same members in reversed key order and
requires 0, while asserting the two stringify differently. C5 is what makes
verdict A (bytes) and verdict B (production) two measured questions rather than
one restated — `hooks.ts`'s `deepEqual` is order-insensitive, so a byte-only
instability would be real and would NOT abort a worker.

---

## 5. What this does and does not close

**Closes:** the sentence in `docs/security-posture.md` that says Pre→Post
`tool_input` stability "is measured for `Bash` and `Write` by
`adjudication-bridge.live.test.ts`, not for `Edit`". It is now measured for
`Edit`, on this engine version, and by a strictly stronger method than the
Bash/Write cases use — those infer stability from the ABSENCE of an audit abort,
which cannot see a key-order change and cannot correlate a specific tool call;
this compares both payloads under one `tool_use_id`.

**Does not close** (recorded in the artifact's `residuals` too):

1. **n = 1.** One arm, one sample, one engine version, one model. The budget is
   the owner's money, not a retry allowance.
2. **Absolute `file_path` only.** `adjudication-bridge.live.test.ts`'s Write case
   drives a RELATIVE path; whether a relative form is resolved between the two
   hooks — which WOULD be a structural difference and hence an abort — is
   unmeasured for `Edit`. The absolute form was chosen because R7-P1's ARM-P
   measured it succeeding under this exact profile, and a refused `Edit` would
   have spent turns and measured nothing.
3. **`MultiEdit`/`NotebookEdit`** and the `Grep`/`Glob` family sit outside
   `ADJUDICATED_BUILTIN_TOOLS` and outside this measurement.
4. **The audit is weak by design, and `NO-ABORT` is not a claim otherwise.** It is
   order-insensitive and name-keyed rather than `tool_use_id`-keyed (its own
   KEYING LIMITATION note). This probe measures that the engine does not trip it;
   it does not measure that it would catch a determined mutation.

---

**No production change is authorised by this transcript.** Its output is evidence.
