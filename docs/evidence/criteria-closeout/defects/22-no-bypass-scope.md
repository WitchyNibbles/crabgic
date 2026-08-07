# Defect 22-no-bypass-scope

**Phase:** 22 — Reviewed learning pipeline & local evals (`roadmap/22-learning-system.md`, exit criterion 8)

**Criterion (verbatim):**

> Project-scoped promotion produces a real `ChangeSet` that clears the same gates (14) as any other change before publish (08) — integration test on fake engine proves no bypass path exists.

**Found:** 2026-08-02, criteria-closeout pass (batch 3, phase 22), at `eabb65acb723ad1e21cfcbe4869fcfb432fe4625`.

**Severity:** evidence-channel-only, shading into blocking-guarantee on the "before publish" clause.

## Gap

The first clause is fully evidenced. The clauses after the em dash — **"integration test on fake
engine"** and **"proves no bypass path exists"** — are not, and the correction that would make the
box tickable is strictly _weaker_ than what it says, which is `UNMET` rather than a wording fix.

### What exists — and it is genuinely non-vacuous

`packages/learning/src/red-team/no-bypass.redteam.test.ts` (1 case) promotes a proposal with two
genuinely-minted, proposal-bound tokens, then:

- `:99-101` constructs `@crabgic/gates`' own public registry and registers one passing and one
  **failing** fake gate — `const gateRegistry = createGateRegistry();` /
  `gateRegistry.register("coverage", "fake-coverage-gate", async () => verdict(false));`
- `:117-118` `expect(results.find((r) => r.name === "fake-tdd-gate")?.verdict.passed).toBe(true);` /
  `expect(results.find((r) => r.name === "fake-coverage-gate")?.verdict.passed).toBe(false);`
- `:119` `expect(results.every((r) => r.evidence.changeSetId === changeSet.id)).toBe(true);`
- `:128` `expect(evidenceEntries).toHaveLength(2);` — two real `evidence_pointer` journal entries
  keyed to the promoted ChangeSet's id.

The failing gate is the anti-vacuity control: an implementation that special-cased
learning-originated ChangeSets into "always green" fails `:118`. That much is real and should be
preserved by any remedy.

### What is missing

1. **There is no engine in the "integration test on fake engine".**
   `git grep -n 'FakeEngineAdapter\|@crabgic/testkit' packages/learning/src/red-team/no-bypass.redteam.test.ts`
   → no match. The fake engine appears in `pipeline.e2e.test.ts`, which does not fire gates; the
   gate-firing test uses no engine at all. The two halves the criterion names as one test are two
   tests that do not overlap.
2. **"No bypass path exists" is asserted in a doc comment, not checked.**
   `no-bypass.redteam.test.ts:28-30` states "_grep confirms zero occurrences of "bypass" or a
   learning-specific gate-registry wrapper anywhere under `packages/learning/src`_". That grep is
   prose. This pass re-ran it independently and it is **true today** —
   `git grep -n 'createGateRegistry\|fireAll\|fireByTag' -- 'packages/learning/src/**/*.ts' ':!…*.test.ts'`
   returns nothing (`docs/evidence/phase-22/closeout-c8-no-bypass-search-trail.txt`) — but nothing
   _enforces_ it. Contrast phase 07's `spawn-surface-scan.test.ts`, which turns exactly this kind of
   absence claim into a permanent static check with its own anti-vacuity floor. A universal-absence
   claim backed by one positive path plus an unenforced comment is not "proves no bypass path exists".
3. **The "before publish (08)" clause is not exercised anywhere, and the shipped path drops the
   ChangeSet.** `packages/cli/src/learning/learn-command-backend.ts:191-201` is the only production
   caller of `promoteProposal`. It constructs the `ChangeSet`, prints it
   (`stdout: formatJson({ promoted: true, changeSet: result.changeSet })`) and returns — the human
   message even says the ChangeSet was "_constructed for the normal scheduler->gates->publish
   pipeline_". Nothing persists it into the durable ChangeSet registry, hands it to
   `@crabgic/scheduler`, or fires a gate against it. So in the shipped system a promoted lesson's
   ChangeSet never reaches gates or publish at all; what the test proves is that _if_ someone fired
   the standard registry against it, it would not be special-cased.

This is why the honest correction is weaker rather than more precise. "A promoted `ChangeSet` is not
special-cased when gates are fired against it" is a real guarantee, and a strictly smaller one than
"it clears the same gates before publish, and no bypass path exists."

### Search trail

Captured verbatim in `docs/evidence/phase-22/closeout-c8-no-bypass-search-trail.txt`:

1. `git grep 'createGateRegistry\|fireAll\|fireByTag'` over `packages/learning/src` non-test source → no match.
2. `git grep 'FakeEngineAdapter\|@crabgic/testkit'` over `no-bypass.redteam.test.ts` → no match.
3. `git grep 'promoteProposal'` over `packages/cli/src` non-test source → one call site,
   `learn-command-backend.ts:191`, read in full.
4. `git grep -l 'publishLocal\|@crabgic/git-engine' -- 'packages/learning/**'` → one hit,
   `promotion/promote.ts`, and it is a **doc comment** (`:27`), not an import or a call.
5. `docs/evidence/phase-22/README.md` §Exit criteria, last box — names
   `no-bypass.redteam.test.ts` and describes it accurately; the README does not claim a fake
   engine or a publish hop, so this is a criterion-vs-implementation gap, not a stale README.

## Proposed remedy

Three parts, separable; part 3 is the one that is not bookkeeping.

1. **Make the absence permanent.** Add a static scan in `packages/learning/src/` in the
   `spawn-surface-scan` idiom: no file under `packages/learning/src` (excluding `*.test.ts` and the
   scanner itself) may reference `createGateRegistry`/`fireAll`/`fireByTag` or define a gate-registry
   wrapper, with an `expect(ALL_SOURCE_FILES.length).toBeGreaterThan(5)` anti-vacuity floor. That
   converts today's true-but-unenforced comment into the check the criterion's words describe.
2. **Put the engine in the integration test**, or drop the phrase. Cheapest faithful version:
   extend `pipeline.e2e.test.ts`'s promotion beat to fire the real `createGateRegistry()` against
   the ChangeSet it already produces — that test already runs on `@crabgic/testkit`'s
   `FakeEngineAdapter`, so it makes "integration test on fake engine" literally true at the cost of
   ~15 lines, and lets the no-bypass file keep its focused failing-gate control.
3. **Decide and evidence the publish hop.** Either (a) `learn approve` persists the promoted
   `ChangeSet` into the same durable registry `run` writes (`bootstrap.ts` already resolves that
   registry for `resolveOngoingIntakeRefs`) so it genuinely enters the scheduler→gates→publish
   pipeline, with a test asserting it is readable back and gate-firable; or (b) the criterion is
   reworded — in its own reviewed commit, not by a closeout pass — to say the phase hands off a
   `ChangeSet` and that dispatch is 13/14/08's, consistent with `roadmap/22` §Out of scope.

**Effort:** part 1 S, part 2 S, part 3 M–L (a) or S (b). **Needs CI:** no.
**Needs live engine:** no. **Needs owner input:** yes, for part 3's (a)-vs-(b) choice.

**Ticket-ready:** yes for parts 1 and 2; part 3 needs the owner ruling first.

## Addendum 2026-08-07 — parts 1 and 2 remedied; part 3 still needs the owner ruling

**Part 1 (make the absence permanent) — done.** `no-gate-bypass-surface.redteam.test.ts` turns the
doc-comment grep into an enforced static scan in the `spawn-surface-scan` idiom this record's remedy
named, with the `toBeGreaterThan(5)` anti-vacuity floor and a directory-resolves guard. Planting one
file that imports the firing surface reddens that case **and only that case**. The stronger form this
record did not ask for — banning the `@crabgic/gates` import outright — was written, measured and
**rejected**: the eval runner legitimately imports `findEvidenceForRequirement`, which roadmap/22's
own §In scope requires, so banning the package would misstate the boundary the criterion draws.

**Part 2 (put the engine in the integration test) — done, by this record's own cheapest faithful
version.** The gate hop is appended to `pipeline.e2e.test.ts`, which already runs on the fake engine
adapter, after its last cited line and through a dynamic import so every line the merged phase-22
record cites stays byte-stable (one hunk). That it binds to the genuine registry rather than a local
double is measured: green-lighting the gates registry's own `fireOne` reddens the new beat alongside
`no-bypass.redteam.test.ts` — but **only after a rebuild**; the src-only leg under-reported the blast
radius to zero, and both numbers are reported. Evidence:
`docs/evidence/phase-22/probe-22-102-batchA.txt`, which says plainly that part 2 makes the conjunct
literally true and adds no new enforcement.

**Part 3 (the publish hop) — still open, and this pass declined to close it by wording.** The
situation is unchanged: `learn-command-backend.ts` is still the only production caller of
`promoteProposal`, and it constructs the `ChangeSet`, prints it and returns. The box at
`roadmap/22-learning-system.md:102` therefore stays unticked. Two measured reasons, not one, for
declining the wording route (option (b)) in this pass:

1. This phase's §Out of scope says a promoted lesson "only constructs and **hands off** a
   `ChangeSet`". The hand-off does not happen either — nothing persists or dispatches it — so a
   criterion reworded to say the phase hands one off would not be borne by the code any more than
   the present wording is. The before/after this pass would have written is therefore **not** a
   wording correction; it would be reading a clause down to what happens to exist.
2. This record's own remedy already rules that option (b) must land "in its own reviewed commit, not
   by a closeout pass". This is a closeout pass.

The gap is now exactly one clause wide, and its disposition is an owner ruling between remedy (a) —
persist the promoted `ChangeSet` into the durable registry so it genuinely enters the
scheduler→gates→publish pipeline, M–L — and remedy (b), S.
