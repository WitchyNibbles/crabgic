# Defect 22-redteam-suite-membership

**Phase:** 22 — Reviewed learning pipeline & local evals (`roadmap/22-learning-system.md`, exit criterion 2)

**Criterion (verbatim):**

> Held-out contamination detected; reward hacking caught by grader isolation; grader-drift attempt blocked; rejected promotion changes nothing; expiry + rollback work — each a separate passing case in the `@learning-redteam` suite.

**Found:** 2026-08-02, criteria-closeout pass (batch 3, phase 22), at `eabb65acb723ad1e21cfcbe4869fcfb432fe4625`.

**Severity:** evidence-channel-only.

## Gap

The criterion names five behaviours and one place: **"each a separate passing case in the
`@learning-redteam` suite."** Every one of the five behaviours does have a real, non-vacuous,
passing case. **Three of the five are not in that suite**, and one of the remaining two has no
case of its own under any name.

`@learning-redteam` is a real, defined channel, not a loose adjective. `roadmap/22` §Interfaces
produced defines it as a _tag_ ("Red-team fixture suite, tagged `@learning-redteam` (mirrors the
`@live` tagging convention P01/P06 use for engine conformance, Gap 15)"), and
`.github/workflows/learning-redteam.yml`'s **first** step is the thing that runs it:

```
- name: "@learning-redteam suite: self-promotion, grader isolation, no-bypass, no MCP tool family, no promptfoo dep"
  run: npx vitest run packages/learning/src/red-team --coverage.enabled=false
```

That step selects exactly 5 files / 20 cases. `docs/evidence/phase-22/closeout-c2-redteam-suite-membership.txt`
enumerates all 20 by name (`npx vitest list packages/learning/src/red-team`), and confirms by
`git grep -l '@learning-redteam'` that the tag appears in those five files and nowhere else under
`packages/learning/src`.

### What exists — and where

| Criterion clause                          | Real, passing case                                                                                                                                         | In the `@learning-redteam` suite? |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------: |
| Held-out contamination detected           | `packages/learning/src/eval/contamination.test.ts` (6 cases: case-hash overlap `:29-36`, shared-provenance overlap `:38-44`, disjoint control `:20-27`)    |              **no**               |
| Reward hacking caught by grader isolation | `packages/learning/src/red-team/grader-isolation.redteam.test.ts` (6 cases) — the sealed held-out directory refuses a direct `node:fs` write with `EACCES` |                yes                |
| Grader-drift attempt blocked              | **no case of its own** — see below                                                                                                                         |              **n/a**              |
| Rejected promotion changes nothing        | `packages/learning/src/proposal-store/registry.test.ts:137-145` — "rejected: changes nothing else about the proposal's recorded evidence/content"          |              **no**               |
| Expiry + rollback work                    | `packages/learning/src/expiry/expiry-sweeper.test.ts` (5 cases) and `packages/learning/src/rollback/rollback.test.ts` (4 cases)                            |              **no**               |

All of them **do** run in `learning-redteam.yml` — but in its **second** step
(`npx vitest run packages/learning packages/cli`), which is the whole-package suite, not the
tagged red-team suite. They also run in `CI / unit-test+coverage`. Passing in the same _workflow_
is not the same as being a case in the named _suite_; the criterion asks for the latter, and the
distinction is the entire reason the tag exists (it is what lets a reviewer run the adversarial
cases alone, exactly as `@live` does).

### "Grader-drift attempt blocked" has no case under any name

`git grep -ni 'reward.hack\|grader.drift\|drift' packages/learning/src` returns two hits, both
unrelated doc comments (`expiry-sweeper.ts:16` "object-id-drift detection",
`reproducer-harness.ts:15` "two drifting"). The grader-isolation suite's six cases are all about
the **held-out** directory's seal; none of them models a _grader_ changing under an in-flight
evaluation, which is what "grader drift" names in `roadmap/22` §In scope ("proposer cannot modify
its grader, held-out cases, or promotion criteria"). Reading the same six sealing cases as
satisfying _both_ "reward hacking caught by grader isolation" _and_ "grader-drift attempt blocked"
also contradicts the criterion's own "**each a separate** passing case".

Note the adjacent structural fact, recorded so the remedy is scoped correctly: only
`grader/held-out/` is ever sealed. `grader/dev/` (`packages/learning/src/store/layout.ts:65-67`) has
no seal step, and no production code constructs a `CaseFixtureStore` at all
(`git grep 'CaseFixtureStore' packages --include=*.ts` outside tests hits only the barrel export
`packages/learning/src/index.ts:59` and the class's own definition).

### Search trail

1. `docs/evidence/phase-22/README.md` §Exit criteria, second box — maps this criterion to
   `contamination.test.ts`, `grader-isolation.redteam.test.ts`, `registry.test.ts`,
   `expiry-sweeper.test.ts`, `rollback.test.ts`, `pipeline.e2e.test.ts`. Every path resolves at
   HEAD (`git ls-files`), so this is not a stale-README defect — the README simply never claims
   those files are in the tagged suite, and the criterion does.
2. `git grep -l '@learning-redteam' -- 'packages/learning/src/**'` → the five `src/red-team/*` files only.
3. `npx vitest list packages/learning/src/red-team` → 20 cases, enumerated verbatim in
   `docs/evidence/phase-22/closeout-c2-redteam-suite-membership.txt`.
4. `git grep -ni 'reward.hack\|grader.drift'` → zero relevant hits.
5. `.github/workflows/learning-redteam.yml` — read in full; two test steps, only the first is the
   tagged suite.

### Why this is not merely bookkeeping

The tagged suite is the artifact `roadmap/23-release-hardening.md` §In scope names when it invokes
"seeded-fault matrices from 14/15/22". A release gate that runs the `@learning-redteam` suite today
exercises self-promotion, grader sealing, no-bypass, the MCP-absence scan and the promptfoo-absence
scan — and **not** contamination, rejected-changes-nothing, expiry or rollback. The criterion's
promise to 23 is therefore wider than what 23 would actually get.

## Proposed remedy

Two independent halves; the first closes the locator, the second closes the missing behaviour.

1. **Bring the three off-suite behaviours into the tagged suite.** Cheapest honest form: add
   `packages/learning/src/red-team/contamination.redteam.test.ts`,
   `.../rejected-promotion.redteam.test.ts` and `.../expiry-rollback.redteam.test.ts`, each a
   thin adversarial framing of the behaviour (a contaminated pair that must be refused _before_
   either eval fires; a rejection that must leave content/evidence byte-identical; a stale
   `EvidenceRecord` that must force `expired`, and a rollback that must produce the inverse
   `ChangeSet`), with `@learning-redteam` in the `describe` name. Do **not** merely move the
   existing unit files — they are unit-level coverage that should stay where it is.
2. **Write the missing grader-drift case.** A case in which a grader/held-out fixture set is
   mutated _between_ the dev eval and the held-out eval, and the eval runner refuses (or the seal
   makes the mutation impossible) — distinct from the existing "write to a sealed directory"
   cases. If the team's position is that grader drift is fully subsumed by the seal, that is a
   wording change to the criterion, reviewed on its own, not something a closeout pass may decide.

**Effort:** M (1 is S; 2 is S–M because it needs a behaviour that does not exist yet).
**Needs CI:** no. **Needs live engine:** no. **Needs owner input:** only if the team prefers to
reword rather than implement half 2.

**Ticket-ready:** yes.

## Remedied 2026-08-07 — with the green-on-write honesty note

PR #115 put all five behaviours in the suite this criterion names. `npx vitest list
packages/learning/src/red-team` enumerates 10 files where it enumerated 5, and a grep for the tag
returns exactly those files, which is what the tag is: a describe-title convention plus the path
selector the `learning-redteam` workflow runs. Evidence:
`docs/evidence/phase-22/probe-22-095-batchA.txt`.

**Stated honestly, because the distinction is the whole point of this record.** Four of the five
behaviours — contamination, rejected promotion, expiry and rollback — already had real, passing,
non-vacuous cases outside the named suite, and their new red-team files were **green on write**. The
measured claim is a membership delta taken with `vitest list`, not a red run, and it is not dressed
as TDD-red. Only grader drift is genuinely TDD-red: it could not even import before the module it
needs existed.

Because four were green on write, their value is carried by mutation rather than by their first run,
and each mutation names its expected-green control in advance: deleting the drift refusal reddens
three while grader-drift's own control and its digest-exhaustiveness case stay green; deleting the
contamination throw reddens two red-team cases while the pipeline e2e stays green, because its two
case sets are disjoint so it never exercises the refusal; falsifying the expiry predicate reddens the
expiry case. The two cross-package legs are reported with **both** the src-only and the rebuilt
numbers, and the finding that they are identical — the CLI-side backend suite is insensitive to
either mutation — is recorded rather than quietly replaced by the stronger number.

**Residual: none.**
