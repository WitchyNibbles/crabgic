# Defect 22-learn-cli-conformance-golden

**Phase:** 22 — Reviewed learning pipeline & local evals (`roadmap/22-learning-system.md`, exit criterion 6)

**Criterion (verbatim):**

> `learn list|approve|reject|rollback` passes P09's CLI conformance harness, replacing its `NOT_IMPLEMENTED` stub (golden CLI-output test).

**Found:** 2026-08-02, criteria-closeout pass (batch 3, phase 22), at `eabb65acb723ad1e21cfcbe4869fcfb432fe4625`.

**Severity:** evidence-channel-only.

## Gap

The four `learn` verbs have a real, well-tested backend and the shipped composition root really
does wire it. But the criterion names two specific channels — **P09's CLI conformance harness**
and a **golden CLI-output test** — and neither exercises the real backend.

### What exists

- `packages/cli/src/learning/learn-command-backend.test.ts` — 13 cases against the real backend
  functions, with real HMAC minting and a real terminal prompt over `PassThrough` streams:
  `:149` `expect(parsed.promoted).toBe(true);` after two distinct `learn approve` calls,
  `:155` `expect(new Set(approvals.map((a) => a.tokenId)).size).toBe(2);`,
  `:172` `expect(mints.length).toBeGreaterThanOrEqual(2);` (two real `approval_token_mint`
  journal entries), `:186` `expect(await registry.getReviewApprovals(proposal.id)).toEqual([]);`
  when the operator declines. Non-vacuous, with fail-closed cases for unknown ids and wrong states.
- `packages/cli/src/bootstrap.ts:307-309` — the shipped composition root supplies the real bag:
  `learning: overrides.learning ?? buildRealLearningDependencies(xdgEnv, projectHash, journal, minter, signingKey),`.
- `e2e/live/src/cliNotImplementedSweep.test.ts:105` — `expect(wiring.learningWired).toBe(true);`
  against the real `buildRealCliDependencies`. (That file is in `e2e/live`'s **offline** default
  project — not an `@live` suite — and is **not** in the root `npm test` fan-out; run standalone.
  Re-run for this pass: `docs/evidence/phase-22/closeout-c6b-production-wiring.txt`, 15 passed.)
- `packages/cli/src/commands/__snapshots__/cli.snapshots.test.ts.snap:174-176` — a committed golden
  for the `learn` **help topic**.

### What is missing

1. **P09's conformance harness never exercises the real backend.** P09 names the harness by suite,
   in its own exit criterion 1 — "_Every plan CLI command exists as a typed UDS request with
   stable exit codes; `--json` validates against published schemas — suite `cli.commands.schema.test`_"
   (in `roadmap/09-cli-and-doctor.md`, quoted rather than line-referenced on purpose: another
   phase's roadmap renumbers whenever its own closeout lands, and this criterion moved twice
   while this record was being written).
   In `packages/cli/src/commands/cli.commands.schema.test.ts` the string `learn` occurs on exactly
   four lines — `:224-227` — and all four sit inside
   `describe("dispatchCommand — NOT_IMPLEMENTED stubs", …)`, asserting
   `expect(result.exitCode).toBe(EXIT_NOT_IMPLEMENTED);` (`:232`). The harness therefore records
   the stub as _still present_, which is the opposite of what the criterion claims it records.
2. **The dispatch-level routing is untested.** `packages/cli/src/commands/dispatch.ts:112-125`
   adds four `deps.learning !== undefined ? …` branches. `git ls-files packages/cli/src/commands`
   shows `connection-dispatch.test.ts`, `installer-dispatch.test.ts`, `intake-dispatch.test.ts`
   and `trust-dispatch.test.ts` — **there is no `learn-dispatch.test.ts`**. No test anywhere calls
   `dispatchCommand({ command: "learn-list", … })` with `deps.learning` supplied, so the wired
   branch is never taken. This is precisely the evidence shape phase 12's analogous criterion
   _did_ have (`packages/cli/src/commands/trust-dispatch.test.ts`, cited in
   `docs/evidence/criteria-closeout/phase-12.json` criterion 6), which is what makes the absence
   here visible rather than a matter of taste.
3. **There is no golden CLI-output test of the learn verbs.**
   `grep -c 'toMatchSnapshot\|toMatchFileSnapshot' packages/cli/src/learning/learn-command-backend.test.ts`
   → `0`. That suite asserts with `toContain`/`toMatchObject` on hand-picked fields. The only
   committed golden touching `learn` is its help topic — help text, not command output. So P09's
   own companion criterion — "_Help text and every `--json` output schema are snapshot-stable —
   suite `cli.snapshots.test`_" (same file, likewise quoted rather than line-referenced) — is
   unsatisfied for these four `--json` shapes too.

Search trail, captured verbatim: `docs/evidence/phase-22/closeout-c6-cli-conformance-search-trail.txt`.

### Independently corroborated by phase 09's own closeout

Found while re-resolving citations against `origin/main` (this pass's base is `eabb65a`; as of
`f05970c` the diff restricted to the 19 paths this pass cites is empty, so nothing cited moved —
note that the weaker _package_-level version of that claim has already rotted, `2ea3689` having
touched `packages/cli`). Phase 09's closeout, run by a different agent, left its own criterion 7 **unticked**
for the same reason and named these verbs explicitly:
`docs/evidence/criteria-closeout/defects/09-json-output-snapshot-coverage.md` — "_No snapshot exists
for the `--json` output of `doctor`, `evidence`, `status` (either shape), `cancel`, `run`,
`approve`, `install`/`upgrade`/`uninstall`, `trust *`, `connection *`, or `learn *`._" That is
convergent evidence, not this pass's own verification: the finding above was reached independently
from `grep -c 'toMatchSnapshot' packages/cli/src/learning/learn-command-backend.test.ts` → `0` and
from reading the committed `.snap`. Whoever fixes either defect should fix the `learn *` rows once.

### Why this is not merely bookkeeping

`dispatch.ts:112-125` is shipped, reachable code that no test executes in its wired form. A typo in
one of the four `case` labels, or a mismatch between the `LearnApproveCommand` shape the parser
produces and the shape the backend destructures, would be caught by neither
`cli.commands.schema.test.ts` (which supplies no `deps.learning`, so it takes the stub branch) nor
`learn-command-backend.test.ts` (which bypasses `dispatchCommand` entirely and calls
`runLearnApproveCommand` directly). The two suites together leave exactly the seam between them
uncovered.

## Proposed remedy

1. Add `packages/cli/src/commands/learn-dispatch.test.ts`, modelled directly on the existing
   `trust-dispatch.test.ts`: drive the real `dispatchCommand` for all four `learn-*` argv commands
   against a tmp-dir-rooted `ProposalRegistry`, asserting `EXIT_OK` and a backend-only string the
   stub can never emit (e.g. `"no learning proposals"`), **plus** the mirror case asserting all
   four still return `EXIT_NOT_IMPLEMENTED` when `deps.learning` is absent — so the routing is
   what changed the outcome.
2. Add golden coverage for the four `--json` payloads (`learn list`, the 1-of-2 approve shape, the
   promoted shape, `learn reject`, `learn rollback`) in `cli.snapshots.test.ts`, with ids/digests
   normalized, closing both this criterion's parenthetical and P09's `cli.snapshots.test` criterion
   for these commands.
3. Optionally move the four `learn-*` rows in `cli.commands.schema.test.ts:224-227` out of the
   NOT_IMPLEMENTED-stub `it.each` into a wired-deps group, keeping the unwired assertion as the
   explicit control.

**Effort:** S. **Needs CI:** no. **Needs live engine:** no. **Needs owner input:** no.

**Ticket-ready:** yes.

## Remedied 2026-08-07 — all three conjuncts, on phase 12's precedent

PR #115 took this record's S-sized remedy, mirroring phase 12's ticked `trust` criterion including
its control shape. `packages/cli/src/commands/learn-dispatch.test.ts` now drives all four verbs
through the real `dispatchCommand` to the real backend, and the golden CLI-output conjunct is borne
by the `learn list --json` snapshot entries.

The seam probe **is** this criterion's redness, and it is worth stating in the record because a
reader who only counts new tests will miss it: un-wiring each verb one at a time — replacing the
whole ternary with an unconditional not-implemented result, exactly as a shipped CLI missing its
composition-root wiring behaves — left 119 files and 1398 tests green, four times over. Afterwards
each un-wiring reddens one or two cases, while `learn-command-backend.test.ts` stays green throughout
because it bypasses the dispatcher, which is precisely the seam this record named. The goldens are
proven load-bearing in the same way: adding a key to the payload reddens both snapshot cases while
the backend suite's `toMatchObject` stays green. Evidence:
`docs/evidence/phase-22/probe-22-100-batchA.txt`, which also records a correction to the plan it
executed — inverting the wiring condition measures the wrong direction and would have produced a red
run labelled as the criterion's green redness.

**Correction to this record's own text, measured 2026-08-07.** This record reads the four `learn-*`
rows inside `cli.commands.schema.test`'s `NOT_IMPLEMENTED stubs` describe as the harness recording
the stub as still present. They are still there, and that is correct rather than a remaining gap:
that suite supplies no learning dependency, and `install`, `run`, `approve`, the connection verbs and
the trust verbs sit in the same `it.each` list while carrying ticked criteria of their own. The
deps-absent row is the **control** — the same one roadmap/12's ticked box cites for `trust` — and
reading it as evidence that a verb is unwired would untick phase 12's box too.

**Residual: none.**
