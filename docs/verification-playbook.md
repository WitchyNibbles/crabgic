# Verification playbook — how work is checked in this repository

**Every ruling here was earned.** Each came from a real defect that a green test suite did not
catch, during the 2026-08-02→06 closeout wave (60 PRs, 25 closeout records, 37 defect records).
Nothing below is style preference; each is a measurement that cost someone a rediscovery.

This file was rebuilt from scratch once after living only in a scratch directory. It is committed
now so the next pass inherits the rulings instead of re-earning them.

**Read all of it before verifying anything in this repo.** If a rule here disagrees with the code,
**read the code and fix the rule** — that has happened four times and each correction is dated below.

---

## ⛔ HARD RULES — no exceptions, no judgement calls

1. **NEVER run `@live` tests, set `CRABGIC_LIVE=1`, or dispatch `engine-live`.** These spend the
   owner's paid subscription and are owner-gated. Zero has been spent across this entire effort.
   If your work seems to need one, STOP and report — do not run it.
2. **NEVER run `git config`** against the repo or any worktree. Worktrees share `.git/config`;
   one bad write corrupts every checkout at once.
3. **NEVER create a worktree inside the repo directory.** A leftover `wt-recover-tmp/` supplied a
   second tsconfig root and broke `npm run lint` repo-wide with 3180 parse errors.
4. **Do not edit** `docs/interface-ledger.md`, `criteria-baseline.json`, or any
   `docs/evidence/criteria-closeout/phase-*.json` outside your own pass.
5. **If a validator rule fails a MERGED record: STOP and report.** Do not loosen the rule; do not
   edit the record. This has fired five times and produced a better rule every single time.
   (If the record is _unmerged_, the record changes, not the rule.)
6. **Do not merge PRs and do not push to another agent's branch.** The orchestrator merges.
7. **Never `git add -A`.** Stage by explicit path. Run
   `git diff --name-only origin/main HEAD -- packages/ e2e/ scripts/` before every push and
   report the result.
8. Conventional commits (`feat|fix|refactor|docs|test|chore|perf|ci`). Push with the hook; if it
   fails on a load flake, retry. `ECC_SKIP_PREPUSH=1` is the sanctioned bypass (hook line 7) and
   is for **docs-only diffs with disclosure** — never `--no-verify`, never for a code diff.

## 🏷️ Isolation hygiene

- Build a worktree that **hardlinks**
  `node_modules` (`cp -al`). Never symlink: `@crabgic/*` are relative symlinks that resolve back
  into the main checkout and silently defeat isolation.
- **Name every scratchpad file with your phase/task suffix** (`resolve-p19.mjs`, `cap-p23.sh`).
  Two passes collided on `resolve.mjs`; a shared `cap.sh` was overwritten and wrote files **into
  another agent's worktree**. The standard contamination check cannot catch that — the damage is
  not in your diff.
- If a helper you did not create already sits at the name you want, assume it is someone else's.

---

## 🔬 THE CENTRAL METHOD — measure, do not read

Reading a test's name or doc comment finds nothing. **Delete the code and watch which suites
redden.** This wave found every real defect that way, and caught **two separate tests whose own
doc comments claimed the opposite of what the test did**:

- a "write-order" suite that called `httpClient.request` directly with hand-written strings,
  wiring no connector at all, while its doc comment claimed the opposite;
- a "type-level proof" whose comment claimed the file "would fail to compile" if a field were
  restored — restoring it gave `tsc` **exit 0** and both tests still passed.

Corollaries:

- **When a test claims a compile-time guarantee, falsify it.** Put the field back, run `tsc -b
--force`, record the exit status. Cheap, and asserting it without measuring is just another
  unverified claim.
- **A criterion whose bearer is a gate or an enforcement:** delete the enforcement and measure
  which suites go red. If none do, the bearer is vacuous.
- **Guard instrumentation.** For any assertion inside a conditional, count how often the branch
  actually fires. One property's claim-bearing branch fired ~0.1 times per run — it evidenced
  nothing. Name the counts in your transcript; exclude vacuous branches rather than quietly
  counting them.

## 📚 Vacuity patterns already found (attack every bearer with these)

- **Tautology over a literal** — asserting `Object.keys(options)` lacks a key, on an object
  literal written one line earlier.
- **Cassette "parity" that cannot fail** — the fixture is byte-identical to `JSON.stringify` of
  the hand-authored script and the runner is a pure function of that script, so the "two
  INDEPENDENT sources" claim is false. Technique that proved it: **byte-level JSON key reorder**
  inside one `bodyText` — semantically invisible, so the strictly-stronger sibling assertion
  failed while the parity assertion stayed green.
- **Tautological gate** — `assertTenantBoundary("tenant-a","tenant-b")`, two literals, so the
  verdict is a compile-time constant. Deleting _all_ enforcement leaves the gate green.
- **Dead code cited as a bearer** — a comparator with zero production callers repo-wide. Grep
  unfiltered (include test files) before treating anything as wired.
- **`it()`-name matching** instead of behaviour.
- **Harness-only reach** — a handler registered in a test registry with no production call site.

## 📐 Citation discipline

- **Build a citation resolver and run it on your own record before you push.** Every pass that
  did found real defects in its own first draft — 9, 11, 18 defects respectively. Typical causes:
  backslash-escaped apostrophes breaking quote pairing, a line number written _inside_ a quote,
  quotes smuggled from outside the cited span, cross-file quotes, and `:NN ` line prefixes
  accidentally captured _inside_ the quoted span.
- **Byte-compare every quoted CI job-log line against the downloaded log.** Neither validator
  checks quoted log content at all. One pass found 16 of its 18 quotes wrong.
  - **Whitespace ruling:** GitHub's raw line is `<timestamp>` + **one space** + content, and
    vitest's own content starts with **one** space before `✓`. One-space (strip timestamp _and_
    separator) is strictly correct — use it. Twelve merged records use a two-space form that
    absorbs the separator; both are contiguous substrings of the raw line, so **no merged record
    is false and none is retrofitted**.
- **Citing a named workflow? Pull the job log, not the run conclusion.** A green run means the
  _workflow_ passed, not that _your test executed in it_. One plan named a workflow that runs
  exactly two files and never the cited test. `check:citation-runs` does not check this.
- **A test lane outside the default `npm test` fan-out is unrun evidence** unless you can cite a
  real run that executed it (`e2e/matrix`, `e2e/attestation`, `docker/*/smoke-test.sh`,
  tag-triggered workflows). Classify as `EVIDENCE-NEEDS-CI`, not `EVIDENCE-EXISTS`.
- **Quote the committed artifact, never a run you remember.** Fast-check guard counts are
  seed-dependent; one pass quoted `198 of 200` when its committed transcript said `200 of 200`.
- **Emptiness proofs rot.** Scope them to the exact paths you cite, not to whole packages, and
  re-run at merge time.
- **The claim-space is not evidence.** `docs/evidence/criteria-closeout/` — the records, the
  README, the frozen baseline, **and `defects/`** — is all written by the same pass in the same
  PR. Never cite any of it. Name a defect record in **prose**. A transcript under
  `docs/evidence/phase-NN/` is outside the claim-space and is legitimate evidence.
  (This rule caught the orchestrator's own work within minutes of landing.)

## 🧾 Transcript + annotation conventions

- **RULING-3 headers:** every committed transcript carries UTC timestamp, HEAD sha, the verbatim
  command, and the exit status. A deliberately RED transcript is fine and often correct — say so.
- **Annotate, never rewrite.** A wrong claim already in the repo gets a dated correction beside
  it, not a silent edit. Applies to evidence READMEs and roadmap prose alike.
- **When you drop a bearer for vacuity, record the vacuity and your reasoning in the notes.**
  A finding that reaches only the orchestrator's scratch file does not exist. It must live in the
  repo — the record's `notes`, the roadmap box, or a defect record.
- **Annotation labels are a closed, disjoint vocabulary**: ticked → `Evidence`; unticked →
  `Left unticked` / `Open defect` / `UNMET`. The label must agree with the box beside it.
- Prettier rewrites `*text*` → `_text_` inside multi-line quotes. Use a fenced block with
  `prettier-ignore` markers for verbatim quotes.

## 🗂️ Closeout record shape

Seven classifications: `EVIDENCE-EXISTS`, `EVIDENCE-REPRODUCED`, `EVIDENCE-NEEDS-CI`,
`EVIDENCE-NEEDS-LIVE`, `SUPERSEDED-DISCHARGED`, `WORDING-MISMATCH`, `UNMET`.

- `defectRef` is legal on **every non-tickable classification** — not UNMET-only. The validator derives
  `DEFECT_REF_CLASSIFICATIONS` as all classes that may not be ticked (`check-criteria-closeout.mjs:182-184`,
  widened during phase 10), so `EVIDENCE-NEEDS-LIVE` and `EVIDENCE-NEEDS-CI` may carry one too. Path shape
  is `docs/evidence/criteria-closeout/defects/<NN>-<slug>.md`. _(Corrected 2026-08-04 — an earlier version
  of this brief said UNMET-only. Read the validator, not this file, when the two disagree.)_
- Every ticked criterion needs ≥1 citation; `WORDING-MISMATCH` needs a before/after.
- **`WORDING-MISMATCH` is not a channel downgrade** — it corrects wording that drifted from the
  phase's own §In scope prose, never weakens a criterion to fit the code.
- **Conjunctive criteria:** flag every "and"/"plus"/"as well as" and evidence each conjunct
  separately. Two phases produced honest UNMETs from a criterion whose halves diverged. Reading a
  clause down to what happens to exist loses a guarantee — that is UNMET, not a wording fix.
- A closeout pass **files defects; it does not fix them.**

## ✅ The gate before every push

`npm run lint && npm run typecheck && npm test && npm run build && npx prettier --check .`
plus `check:criteria-closeout`, `check:criteria-baseline`, and `check:citation-runs`
(export a `GITHUB_TOKEN` — without one it silently skips).

Known load flakes, retry rather than bypass: `packages/perf/src/measurement/command-runner.test.ts`
(`cpuUserMs + cpuSystemMs` reads 0 under contention); `packages/journal/src/lease.test.ts`
`onLeaseLost`/`autoRenew` arms (real-timer races).

## 🗣️ Reporting

Report what you measured, with numbers. If a plan I gave you is wrong, **say so and prove it** —
one agent correctly overruled a plan of mine that named a workflow which never ran the cited test.
If you could not do something, say that plainly rather than narrowing scope silently.

## 🔁 CROSS-PACKAGE DELETION PROBES MUST REBUILD — or they silently under-report

Measured on PR #84. `connectors-jira` imports `@crabgic/gateway` from **`packages/gateway/dist/`**, not
`src/`. So a gateway **src-only** edit is invisible to every connector suite until the workspace is
rebuilt:

| probe                                          | result                                      |
| ---------------------------------------------- | ------------------------------------------- |
| delete the pipeline consumption line, src only | 3 failed / 52 passed                        |
| **same deletion, after `npm run build`**       | **6 failed / 49 passed — all three suites** |

The src-only run understates the blast radius by half. **Run `npm run build` before measuring any
deletion that crosses a package boundary**, and record both numbers rather than quietly keeping the
stronger one. A probe that under-reports looks like evidence of a narrow dependency when in fact it
is evidence of a stale `dist`.

Corollary for vacuity hunts: "I deleted X and only suite Y reddened" is **not** a safe conclusion
about coupling unless you rebuilt first.

## ⏱️ CONCURRENCY TESTS: deferred-promise barriers, never wall-clock holds

A wall-clock hold makes the assertion a race with CI load. Use a deferred promise whose fallback timer
is reachable **only by the first request of a correctly-serialized batch** — then load _lengthens_ the
hold and makes the controls more reliable rather than less. **No test should assert a duration.**
Always pair a `maxInFlight === 1` claim with a `=== 2` control that is green _before_ the fix — that
control is what rules out zero-latency instrumentation making your assertion pass for free.

## 🕵️ A TYPE-NAME GREP DOES NOT FIND ALL CONSTRUCTION SITES

A plan censused `SupervisorDependencies` literals at **5** files. The real number was **9**. The four
it missed build an **inferred object literal** and pass it straight to the consumer without ever
naming the type, so `grep SupervisorDependencies` cannot see them.
**Census by consumer, not by type name:** grep for calls to the function that _takes_ the type.

## 🚨 `as never` / `as any` CASTS DEFEAT A REQUIREDNESS FIX — hunt them explicitly

Making a field required did **not** catch `closed-loop.e2e.test.ts`, because it passed `deps as never`.
That suite ran **real** intake (which persists `Requirement` records) and then handed the dispatcher a
bundle that dropped them — i.e. **the test was asserting the broken behaviour** and the cast hid it
from the compiler.
When you make something required to close a hole, `grep -rn 'as never\|as any\|as unknown as'` over the
affected call sites. A cast is exactly where the hole survives. And when an existing test reddens, ask
first whether it was **asserting the bug** — if so it must change, and say so in the commit message.

## ✅ RULING — run-level vs per-unit failure for an UNRESOLVABLE requirement id

**Run-level `failed` is correct. This is a deliberate distinction, not a stopgap.** Reasoning:

- **Tamper** = the approved criteria changed after approval. That is a judgement about _one unit's_
  work against its bar ⇒ per-unit `failed` + typed reason, as phase 24 specifies.
- **Unresolvable declared id** = the run's own acceptance basis is incoherent — the registry does not
  contain what intake declared. That is an integrity failure of the run's _inputs_, not a verdict on a
  unit's output. If the requirement source cannot be resolved, **every** unit's verification in that
  run is untrustworthy, not just this one, so settling the remaining units and reporting success would
  be the wrong behaviour.

⇒ Do **not** widen the contracts-owned 3-member `CriteriaSealFailureReason` for this. Record the
distinction where a maintainer will meet it (code comment + the phase-24 annotation), so it reads as
a decision rather than an accident.

## 🚫 YOUR OWN DRAFT WILL CONTAIN A FABRICATED QUOTE — the resolver is how you find it

A pass's first resolver run found **9 genuine defects in its own draft**, including a **quote
attributed to a `golden.test.ts` that did not contain it**. Not a typo — text that was never in the
file. Also: 7 backslash-escaped apostrophes breaking quote pairing, 2 out-of-span quotes, and a
job-log line number off by 176 lines (802 vs 626 — 802 was a _different file_ in the same job).

Nobody writes a fabricated citation on purpose. It is what happens when you reconstruct a quote from
memory of what a file "obviously" says instead of reading it back. **The resolver is not a formality
— it is the only thing standing between you and a false citation in a merged record.**

That pass also **mutation-tested its own resolver three ways** (flipped assertion, moved span,
falsified log quote — all three caught) and found a bug in the resolver itself: naive `'…'` pairing
broke on English possessives and produced 91 phantom problems. **Mutation-test your resolver, or you
do not know whether its silence means clean.**

## 🔍 ASSERT THE TYPED KIND, NOT JUST THE THROW

`expect(...).toThrow(ConnectorError)` passes for **every** kind. A probe downgraded a branch from
`ConnectorError.unsupported` to `.validation` and **625 files / 6216 tests stayed green repo-wide.**
If a criterion says "typed `unsupported`", a bare `.toThrow(ConnectorError)` is not a bearer.
When a criterion names a specific error kind, provider, or code, the probe is: **change the kind and
see whether anything reddens.**

## 🧬 CHECK WHETHER YOUR "TWO FIXTURES" ARE THE SAME BYTES

Two per-edition cassettes claimed to back a `(10.3 and 11.3)` conjunct turned out **byte-identical**
(`md5 0494d8e1…`). Two files with different names are not two sources. `md5sum` them.

## 🛠️ `gh pr edit --body-file` FAILS in this repo

It aborts on a Projects-classic GraphQL deprecation. Use instead:
`gh api -X PATCH repos/WitchyNibbles/crabgic/pulls/<N> -F body=@<file>`

## 🧭 DOCUMENT A RULING WHERE THE READER LANDS, NOT WHERE THE ARGUMENT HAPPENED

When a decision resolves a silence in a spec, put the _reason_ — not just the fact — at every site a
maintainer could arrive from: the call site, the parallel seam, **and the function that actually
implements it**. State what the behaviour _means_, name the opposite case it is distinguished from,
and say explicitly that the spec was silent and the silence was filled by a ruling. A bare "note: this
fails the whole run" reads as an accident; the same line plus its reasoning reads as a decision.
⚠️ Three copies of a rationale are three chances to drift — keep them consistent, and if you add a
site beyond what you were asked for, say so.

## 📊 THE RESOLVER NUMBERS THAT SETTLE THE ARGUMENT

A phase-23 pass's resolver found **118 defects in its own first draft**, over 119 citations. Of its 110
quoted CI job-log fragments, **94 line numbers were wrong on the first pass.** Final state: 0 defects.

If you are tempted to skip the resolver or the job-log byte-comparison because your citations "look
right": they do not. Ninety-four out of a hundred and ten. Neither validator checks either thing.

Residual classes that survive a naive resolver and need hand-checking: vitest's **two**-space duration
separator, cross-file quotes, and nested-quote boundaries.

## 🎯 A GATE THAT PASSES FOR THE WRONG REASON IS A FINDING

Phase 23's reproducible-build pin clause **passed because of a checkout-vs-candidate skew**:
`marketplacePinCheck` accepts an ancestor pin only when the intervening span touches nothing outside
`packages/plugin/.claude-plugin/`, and at the attested candidate four of five changed paths were
outside it. The gate went green on a tree that was not the candidate.
**When a check passes, ask _why_ it passed** — not just whether. "Green" and "green for the stated
reason" are different claims, and only the second is evidence.

## 💀 RESTORING AFTER A PROBE — three ways it silently destroys your own work

All three seen for real in this effort. Every one produced a **clean exit code**.

**1. Directory restore deletes uncommitted files.** `git checkout -- packages/foo/` reverted an
uncommitted test the agent had just written. The probe reported **EXIT 0 / "12 passed"** — a false
green with the assertion silently absent, caught only by noticing the test _count_.

**2. `git checkout -- <path>` restores from the INDEX, not from HEAD.** A probe ran
`git checkout HEAD~1 -- <path>` (which **stages** the parent version), then "restored" with
`git checkout -- <path>` — silently reverting the worktree to the _parent_ version, **deleting the very
test the probe had just proved load-bearing.** Exit codes clean throughout.
⇒ **An explicit file path is not enough — the SOURCE must be explicit too: `git checkout HEAD -- <path>`.**

**3. Restoring by directory when the probe target and an uncommitted test share a tree** — same as (1),
and the standard pre-push contamination check cannot catch it, because the damage is not in your diff.

**Countermeasures, all three of them, every time:** restore with an explicit source **and** an explicit
path; **check the test COUNT, not the exit code**; and `git status` + grep for your new test's name
afterwards. A probe that "passes" because your assertion vanished looks identical to one that passes
because the code is correct.

## 🔄 REVERSE PROBES: prove the guard bites in the direction that matters

To pin that a connector _lacks_ a hook, do not only assert absence — **add the hook and watch the
assertion fail** (`expected [Function serializationTarget] to be undefined`). Likewise, to pin that a
passthrough must not be folded, **fold it and watch the assertion fail**
(`expected 'issue:PROJ-1' to be 'bulk:PROJ-1,PROJ-2'`). An assertion nobody has ever seen fail is not
yet known to be non-vacuous.

## 📛 ASSERT A RESIDUAL, DON'T JUST DESCRIBE IT

When you deliberately leave a gap open, encode it in a test so it cannot change silently. A residual
named only in prose drifts; a residual pinned by an assertion announces itself the moment someone
alters it.

## 🎯 YOUR RESOLVER MUST LINE-ANCHOR EVERY FRAGMENT, NOT JUST FIND THE STRING

A pass's resolver reported **"190 matched, 0 problems"**. An independent reviewer's resolver found
**19 real defects** in the same record: 16 per-fragment `:NN` markers off by 1–5, and 3 quoted lines
sitting **outside their own cited span**.

The difference: the first resolver verified that each quoted string **exists in the cited file**. It
never checked that the `:NN` marker written beside the quote is **the line the string is actually on**,
nor that the marker falls **inside the citation's declared span**.

**Two checks, not one:**

1. does the quoted text appear in the file? _(most resolvers do this)_
2. is it on the exact line the marker claims, and is that line inside the cited span? _(this is where
   the defects hide)_

⚠️ **Cross-check your own artifacts against each other.** In that record, a committed transcript
grepped a line at `:27` while the JSON cited `:26` **for the same line, in the same PR**. Two files
you wrote disagreeing is a free defect detector — diff your transcripts against your record.

Nothing was fabricated in that record and no classification changed. But a wrong line number in a
merged record is exactly what this discipline exists to prevent: it resolves, it validates, and it
points at the wrong place forever.

## 🪞 BOILERPLATE AMBIGUITY DEFEATS A PURE BYTE-COMPARER

A record quoted `"verdict": "PASS",` from a large JSON report and attached it to **six different
criteria** — each time citing **another item's** line number. A byte-comparing resolver passed all six,
because that exact string appears at _every_ item's verdict line. The true lines were 50–130 lines away.

**When you quote a repeating structural line, the quote does not identify the location.** Anchor on
something unique — the item's `id` line, a distinctive `details` string — or verify the offset from the
id line (in that report, every verdict sat at id-line + 3). Same hazard for `exitStatus`, `"status":`,
`ok: true`, and any table row.

## 🧨 DELETING A RULE MUST REDDEN ITS OWN TEST — check after you change the surrounding rules

Removing the phase-23 grandfather exemption silently **de-fanged a validator self-test**: deleting the
duplicate-phase-number rule left **all 142 tests passing**. Cause — with the exemption gone, a _different_
(now universal) rule reported the same file, satisfying the test's loose `toContain("23-supplement.md")`.
The test still passed for a reason that had nothing to do with the rule it was meant to pin.

**Assert the rule's distinctive message, never just the offending filename.** And whenever you change
rule A, re-run the deletion probe for rule B — coverage can migrate between rules without any test failing.

## 📄 "COMMITTED" IS A CLAIM ABOUT GIT, NOT ABOUT YOUR DISK

A record asserted three times that a reader "opening the repository file" finds a stale report. That file
is **gitignored and has never been committed in the repo's history** — it existed only as a local
build artifact. The claim was inherited from a plan and never measured.
**Before writing that a file is committed:** `git log --oneline -- <path>` (empty = never committed) and
`git cat-file -e <rev>:<path>`. `ls` proves nothing — your worktree is not the repository.

## ⚖️ USE THREE-DOT DIFF FOR THE CONTAMINATION CHECK WHEN MAIN HAS MOVED

Once `origin/main` advances past your branch point, the two-dot form
`git diff --name-only origin/main HEAD` **falsely attributes other people's merged files to you** —
one agent saw 12 files from a peer's merged PR appear as "mine".

Use the merge-base form:
`git diff --name-only origin/main...HEAD -- packages/ e2e/ scripts/` ← three dots

Report which form you used. And **do not rebase merely to tidy this** — rebasing invalidates the HEAD
shas in transcripts you have already captured, which is a real loss for a cosmetic gain.

## 🔗 A TRANSCRIPT'S `HEAD:` SHA MUST BE REACHABLE FROM THE BRANCH

Amending after capture leaves the cited sha as a **loose object** — present in your local store, gone in
a fresh clone. Verify every transcript header:
`git cat-file -e <sha>^{commit} && git merge-base --is-ancestor <sha> HEAD`
Recapture at a real commit where you can. Where you cannot, add a **dated correction** stating the sha is
unreachable and pointing at a checkable re-proof of the same claim — annotate, never rewrite.

## 🧪 PIN A "FAILS" RULING WITH A "DOES NOT FAIL" CONTROL

When a ruling says some condition fails the whole run, assert the failure **and** assert a clean case
that is _not_ failed. Otherwise "this composition fails every run" would satisfy your tests equally well.

## 🧰 THE RESOLVER DESIGN THAT ACTUALLY WORKS (build this, not a byte-comparer)

Evolved across three passes and two independent reviews. A resolver needs **four** rules, not one:

1. **Content** — the quoted text exists in the cited file. _(the naive check; catches least)_
2. **Line anchoring** — the text is on the exact `:NN` the marker claims, **and** that line falls inside
   the citation's declared span. Caught 19 defects a content-only resolver passed.
3. **Group consecutiveness** — for `:LO-HI 'a' / 'b' / 'c'`, verify the fragments are **consecutive
   lines**. A resolver that only anchors the _first_ fragment after a `:NN` will pass a citation whose
   **range head is wrong while every fragment is real**.
4. **Repeat-text detection** — count fragments whose text occurs more than once in the file and declare
   them _position-verified_, not merely content-verified. In one record **34** fragments were repeats.
   For a structured report, scope a citation to the **item block its quoted `id` names** and fail any span
   that escapes that block.

Also: **never anchor on a generic line.** One citation anchored on `'    if ('` — quote a distinctive
line from the body instead, and say in the citation that you did.

## 🔎 `git log` OVER THE PATH IS THE ONLY PROOF A FILE IS COMMITTED

Restating, because a resolver AND a plan both missed it: `ls` on a working tree **cannot distinguish a
gitignored build output from a committed file.** Before any claim that a reader "opening the repository
file" sees something: `git log --oneline --all -- <path>` (empty ⇒ never committed) and
`git cat-file -e <rev>:<path>`.

## ⏳ CROSS-CHECK A TRANSCRIPT AGAINST THE COMMIT ITS OWN HEADER PINS — not the working tree

Refinement of the transcript-vs-record cross-check. A transcript's `git grep -n` output is pinned to the
HEAD in its RULING-3 header. Checking it against your **current** tree reports every line that any _other_
merged PR has since shifted **as though your transcript were wrong** — a flood of false positives that
will make you "correct" a transcript that was right.

Verify each transcript's output at **the commit its header names** (`git grep -n … <sha>`), and mutation-
test that checker in both directions. One pass verified 41 grep lines this way: 0 disagreements.

## 🧮 SETTLE THE REBUILD QUESTION BY MEASUREMENT, NOT RITUAL

The rebuild rule exists because cross-package imports resolve through `dist`. You can discharge it
directly: `git grep` each symbol your probe mutates and show it has **no consumer outside the package**
(`exit=1`). One pass did this for five mutated symbols and settled the question for four probes at once.
Cheaper than rebuilding, and it is evidence rather than a precaution.

## 🔢 A TRANSCRIPT'S NUMBERS MUST BE CONSISTENT WITH THE TREE ITS HEADER CLAIMS

A re-cut transcript's RULING-3 header named HEAD `29e71dc` (a post-merge tip), but all four repo-wide
runs inside it reported **625 files / 6216 tests** — the totals of the **pre-merge** `3dec9bf` tree. At
the claimed HEAD a repo-wide run sees **627** files, because the merged PR added two test files.
The commands had been run in the old worktree while the header was written from the branch tip.

Nothing about the conclusion was wrong; the **provenance** was. That is still a RULING-3 violation — the
header must pin the sha the commands actually ran at.

**Self-check before committing any transcript:** does its file/test count match what that sha would
produce? `git diff --name-status <old> <claimed-head> -- '*.test.ts'` tells you whether the totals should
have moved. When you re-cut after a merge, re-cut **in the merged tree** — do not re-label an old run.

## ♻️ WHEN YOU CORRECT A LINE NUMBER, GREP FOR EVERY COPY OF IT

A pass corrected a citation `:344 → :345` in the JSON and left the **same number in the roadmap box
prose**, contradicting its own claim that every line number resolves against the tree the branch lands
as. Line numbers get quoted in the record, the roadmap annotation, the defect record and the transcripts
— `git grep` the old value across all four before declaring the correction done.

## 📌 RULING-3 AMENDED — pin transcripts to an UPSTREAM BASE, never to your branch tip

Learned by watching it fail twice in one pass. A `HEAD:` line must name an object id **a reader can
resolve after the branch merges.** A pre-merge branch commit is not one: every rebase orphans it.

Measured on one branch across four mid-review merges: the **seven** transcripts pinned at an upstream
`main` commit survived all four rebases _and_ a commit-message reword untouched. The **two** pinned at
their own branch tip died **twice each** — the second death took the very id a correction had just
re-proved things at.

Use two lines:

```
# UPSTREAM BASE (stable — resolves for any reader, now and after merge): <origin/main sha>
# branch tip at capture (PROVISIONAL — see note): <sha>
```

And **stop recapturing** once you notice you are chasing your own tip — fix the anchor instead.

⚠️ Not every unreachable 40-hex string is a dead commit. One transcript's `faca5f37…` is **npm's
`dist.shasum` for a published tarball.** If you commit a 40-hex that is not a git object, say what it is
in-file, or the next auditor will "fix" it.

## 📊 RECORD THE UNMUTATED BASELINE BESIDE EVERY MUTATION RUN

The reason a wrong-provenance transcript survived review: it contained only mutation runs. **With nothing
to compare against, `625 files` looked like a result rather than a provenance error.** Had the baseline
been captured in the same section at the same sha, the mismatch would have been visible on sight.

Every probe transcript gets three things at the same HEAD: **baseline → mutation → restore.** The
baseline is not padding; it is what makes the other two legible.

## 🧹 THE PROSE IS UNCHECKED — build a sweeper for it _(⚠️ HALF-SUPERSEDED 2026-08-07 — the sweeper exists now; read the amendment at the end of this file)_

Three checkers, three blind spots: the **resolver** reads only the record JSON, the **transcript
cross-checker** reads only transcripts, and **nothing reads the prose** — roadmap annotations and defect
records are full of `path:NN` references that no tool validates.

A pass corrected a line number in the JSON and left the stale value in **two** prose files. Build a
sweeper that resolves every `path:NN` in your annotations and defect records against the tree the branch
lands as, and mutation-test it (a line past EOF; an identifier occurring nowhere in the cited file).

⚠️ **Cite `file.ts:345`, not a bare `:345`.** A bare marker is invisible to a sweep and to your own
`git grep` when you later correct it.

⚠️ When your sweeper flags something honest, **soften the rule to report that shape — do not tune the
tool green.** One real case: prose said tests run "through a real `GatewayHttpClient`" beside a citation
where the symbol appears at `:2`/`:18` via a helper the tests call. True prose, imprecise anchor: report
it as a note, not a failure.

## 📏 TWO SEPARATE HAZARDS — a wrapping ref, and an unchecked bucket

_(Corrected 2026-08-04: I originally blamed the wrap for both. The implementing agent showed its
sweeper already joined wrapped lines and had surfaced the ref — so only the second cause was real.
Read the tool before diagnosing it.)_

**Hazard A — line-based greps miss refs that wrap.** `"§Exit criteria,"` and `"line 91"` sat on two
different source lines, so a per-line pattern could never match. Join the document (or use a
multiline/`-z` match) before hunting cross-references. Prose wraps; your regex does not know that.

**Hazard B — and this is the one that actually caused the miss: a `HAND-CHECK` bucket that was never
hand-checked.** Five stale refs sat in it while the headline count implied everything was verified.
**A bucket named "hand-check" is a promise.** Either check it item by item and say so, or report it as
unchecked — never let it sit between "verified" and "unknown".
The structural fix beats the promise: replace the bucket with a **mechanical section-containment
check** (is the target line inside the section the ref names?), exiting non-zero on mismatch. That
caught 3 of the 5 automatically. It cannot catch an off-by-two _inside_ the right section — so
hand-check the remainder **and list them**.

## 🪤 `git diff -U0` COALESCES ADJACENT CHANGED LINES INTO ONE HUNK

Counting `@@` headers to prove "N lines changed" **under-reports** when edits land on adjacent lines:
22 edits reported as 19 hunks (`@@ -462,2`, `@@ -535,3`). A reviewer counting hunk headers would see a
false mismatch against your `--numstat`. Expand hunk ranges rather than counting headers, and state the
expanded line list explicitly.

## 🎯 DISAMBIGUATE BY SECTION WHEN CONTENT REPEATS

One anchor's quoted string occurred **twice** in its target — once in §Interfaces produced, once in
§Exit criteria. Content matching alone would have picked the wrong one. When a fragment repeats,
resolve it by the section the ref names, not by first match.

## ❌❌ THE LEDGER'S INBOUND-CITATION SET — corrected TWICE, and this is why

**Round 1 (orchestrator, wrong):** `phase-22.json`→`:145`, `phase-04.json`→`:712`, plus 17/07.
**Round 2 (my "correction", ALSO wrong):** I declared `:145` and `:712` "cited nowhere — those records
reference the ledger by Gap number." False.
**Round 3 (measured by an independent reviewer) — the real set:**

- explicit `interface-ledger.md:NN` form → `phase-05.json`→`:111` · `phase-17.json`→`:400-402` ·
  `phase-07.json`→`:714-717` **and `:726-727`** · **plus prose copies in `roadmap/07` and `roadmap/17`**
- **prose `line NN` form, which every earlier list missed entirely** → `phase-04.json:499` ("at line
  **712**") · `phase-22.json:132` ("(line **113**) … quotes this very criterion back at line **145**") ·
  `phase-08.json` ("names 14 as another writer (line **379**)")

**Protected line set: {111, 113, 145, 379, 400-402, 712, 714-717, 726-727}.**

### The lesson, which is bigger than the list

A `grep -E 'interface-ledger\.md:[0-9]+'` is **notation-blind**: records also cite the ledger as prose
("at line 712"), and that form carries no filename on the same match. **My round-2 grep found nothing
and I published "cited nowhere" as a measurement.** A grep that cannot express the second notation
returns a _smaller_ answer with no error — the same failure shape as a mis-scoped pathspec.

**Search for the notations, not the pattern you happen to know.** Before claiming a citation set is
complete, enumerate the _ways_ a citation can be written in this repo and show your search covers each.

## ⚠️ `packages/*/src` AS A GIT PATHSPEC DOES NOT MATCH `packages/cli/src/**`

`git grep … -- 'packages/*/src'` is a **wildmatch** pathspec: `*` does not cross `/`, so nested paths
are silently skipped. One grep reported **2** production hits where the correct scoping found **6**.
A mis-scoped pathspec returns a _smaller_ answer with no error — exactly the shape that reads as
"clean". Use `-- packages` and filter, or `':(glob)packages/*/src/**'`.

**Better still: prove the claim positively.** Rather than "grep found nothing", show the exhaustive
structure — e.g. `terminalStateFor` returns only blocked/failed/cancelled/undefined, and
`LIFECYCLE_WALK = ["awaiting_approval","ready","running"]`. A positive structural proof does not
depend on your pathspec being right.

## 🎯 PROVE A SCOPE TRIPWIRE BY IMPLEMENTING THE _NARROWER_ FIX

The strongest evidence that a broad fix was necessary is measuring the narrow one. A pass implemented
the **href-only** version it had rejected and ran its own suite:

| probe                         | result                                                         |
| ----------------------------- | -------------------------------------------------------------- |
| A — delete the check entirely | 6 failed / 79 passed (all assertions load-bearing)             |
| **B — narrow to href-only**   | **3 failed / 82 passed: T4 stays RED while T1/T2/T3 go green** |

Without probe B, T4 looks like a restatement of T1 and a reviewer could reasonably ask to drop it.
With it, T4 is _measured_ as the tripwire that separates "scan the serialization" from "scan the href".
**When you widen a fix beyond the reported symptom, implement the narrow version and show which test
survives it.** Test counts constant across all runs (85), restores by explicit file path, file hash
returned to baseline each time.

## 🔐 NEVER BYPASS THE SECRET PRE-COMMIT HOOK — assemble the sentinel at runtime

A secret-shaped test fixture (a literal `AKIA…`) tripped the repo's own pre-commit secret scan. The
pass did **not** bypass it: the test files **concatenate the sentinel at runtime** (identical runtime
value, no literal on any added line) and the transcript elides it with an in-file note.
Any future secret-shaped fixture will hit this. Assemble, do not bypass.

## 🩸 ADDING A CHECK CAN SILENTLY UN-PIN THE ONE IT SITS BESIDE

A PR added a serialization-wide secret scan **alongside** an existing extracted-text scan, and
documented in two places that the text scan **must remain** (JSON escaping defeats `\s`-bearing
patterns). A reviewer then deleted the text scan: **all 49 files / 484 tests stayed green.**

Before the PR that deletion reddened the pre-existing text-secret tests. After it, the new scan
**absorbed every one of their fixtures** — `AKIA…` in `node.text` survives `JSON.stringify` verbatim —
so coverage migrated from one check to the other and the invariant became enforced by **comments
alone**. The exact weakening the PR warned against would now land green.

**Rule: whenever you add a check that overlaps an existing one, delete the OLD one and confirm
something still reddens.** If nothing does, you have widened coverage and destroyed a pin in the same
commit. The fix is one test whose subject the old check catches and the new one cannot — here,
`aws_secret_access_key\n= …` in `node.text`, which matches the text scan but **not** its JSON
serialization.

This is the same shape as the earlier de-grandfathering finding: **coverage can migrate between rules
with no test failing.** Both times it took deleting the older rule to see it.

## 📝 DOCUMENTATION CAN DISABLE THE GUARD IT DOCUMENTS

_(Added 2026-08-07.)_ The two sections above are about coverage migrating between rules, and about
encoding a residual so it cannot drift. This is a third member of the family and it is nastier than
either, because the disabling edit **looks like the fix**.

`packages/testkit/src/git-spawn-hygiene.test.ts` exempts a file from its mutating-git-spawn rule when
the source textually contains one of three sanctioned scrub identifiers. `scripts/check-marketplace-
pin-digest.mjs` had just been corrected to spawn only read-only subcommands, and carried a
DO-NOT-REFACTOR note **naming all three helpers to explain why a build-free script cannot import
them.** The note matched the exemption. Measured:

| probe                                                    | guard                   | should be |
| -------------------------------------------------------- | ----------------------- | --------- |
| reintroduce the generic `git(repoRoot, args)` helper     | 4 passed                | red       |
| add outright `git commit -am` **and** `git reset --hard` | 4 passed                | red       |
| after de-tokenizing the comment, same mutating spawns    | **1 failed / 3 passed** | red ✅    |

**The sentence claiming the property was machine-checked was the thing switching the machine off.**
The file's own evidence transcript asserted "now checked by a machine instead of asserted in prose" —
false, and false _because_ of the words asserting it.

**Rules:**

1. **A guard whose exemption is a textual token can be disabled by prose ABOUT the guard.** When you
   must discuss an exemption mechanism, name it obliquely — refer to the module, never to its
   exports.
2. **Never write "this is now machine-checked" without a reverse probe.** Add the violation the guard
   exists to catch, watch it redden, restore. An exemption is invisible in the passing direction —
   green looks identical whether the guard ran or skipped the file entirely.
3. Presence-not-proof exemptions are a deliberate trade (cheap, hard to bypass by accident). The edge
   is a documented cost, not a bug to fix by tightening the regex — which is why the cost is now
   written at the definition site as well as here.

⚠️ Corollary for any presence-based rule: **grep the exemption tokens across the tree and ask which
matches are prose.** A file that names a sanctioned helper without using it is exempt and nothing
says so.

## 🔢 PROVE A NEW ASSERTION RUNS PER-PUSH BY THE JOB LOG'S TEST COUNT

The cheapest, hardest proof that your fix actually executes in CI — not just that a workflow was green:

```
main @ a7988c1, job 92111526601:
 ✓  @crabgic/gates  src/security-fixture-manifest.test.ts (16 tests) 17ms
PR  @ 1c51e5f, job 92311088519, log line 570:
 ✓  @crabgic/gates  src/security-fixture-manifest.test.ts (21 tests) 21ms
```

Same file, same job, **same runner label**, count moved by exactly your delta. Byte-compare both lines
under the one-space rule and quote them. A green workflow proves nothing about _your_ test.

## 🕸️ `grep 'from "@pkg/name"'` MISSES MULTI-LINE IMPORTS

A consumer census using that form found **10** files where an unscoped grep finds **42** — multi-line
`import {\n  a,\n  b,\n} from "@pkg/name"` does not match on the `from` line alone. Combined with the
wildmatch-pathspec hazard, **two independent ways to get a smaller answer with no error.**
Census by unscoped grep, then filter. And confirm mechanically: after removing an export, `tsc -b`
exiting 0 _plus_ a RED stage proving `tsc` does catch a missing export (TS2305) is real evidence.

## 🎯 A "REFUSED" ASSERTION CAN MATCH BOTH THE FIX AND THE BUG

A planned test matched only `/out-of-allowlist org/` on the verdict detail. Under the enforcement
deletion the **fail**-verdict detail _also_ contains the scenario name — so the assertion would have
passed in both worlds. The implementer caught it and asserted `passed === true` **and** the detail
match. **When you assert on an error/verdict string, check the opposite outcome does not contain it.**

## 🪝 THE PRE-PUSH HOOK IS WEAKER THAN CI — commit subject length is not checked locally

A commit with a **118-char subject** passed the local pre-push hook and **failed `commitlint` in CI**
(100-char limit). The hook does not check header length. Before pushing, run
`npx commitlint --from origin/main --to HEAD` yourself — a green hook is not a green CI.

## 🔁 WHEN A CLAIM WAS WRONG, CHECK WHETHER THE _PROOF_ SHARED ITS BLIND SPOT

An agent published a wrong citation set from a **notation-blind** grep. Correcting the claim was the
easy half. It then noticed its **Proof 7 used the identical grep** — so the proof was unsound for the
same reason, and _that_ was the dangerous half.

The replacement is a **notation-aware census**: `git grep` every file mentioning the target, then scan a
±240-char window around each mention for **every** notation. Result: 217 files scanned, 176 distinct
referenced line numbers, mutation-tested in **both** notations (inject prose `line 613` → caught; inject
explicit `:596` → caught), deliberately **over-inclusive** — the safe direction, since if the
over-inclusive set misses your edit range, the true set certainly does.

**A wrong answer usually means a wrong instrument. Fix the instrument, then re-derive.** The census is
a better artifact than the list that would have been published had the claim been right first time.

## 🏷️ DO NOT STAMP "VERIFIED" ON AN ENUMERATION YOU DID NOT ENUMERATE

Two committed files said the root `vitest.config.ts` projects are "`packages/*` plus `e2e/report`" —
and the transcript added _"Verified in this tree, not assumed."_ The config declares a **third**
project, `scripts` (`vitest.config.ts:84`). The plan had it right; the write-up dropped it.

The conclusion was unaffected (the missing item only strengthened it), but a **false exhaustive claim
carrying a verification stamp** is worse than an unstamped approximation — the stamp is what stops the
next reader checking.

**When you write "the X are A and B", re-read the source and count.** And if you cannot enumerate
exhaustively, say "including" rather than "are", and drop the stamp.

## 🎭 A GATE CAN ONLY BE AS HONEST AS THE SCENARIO IT RUNS

Attack G on a replaced security gate: mutating the **scenario's own verdict** (`passed: result.ok ===
false` → `passed: true`) left gates **and** the connector fully green (83 files / 660 tests). The gate
faithfully reports whatever the scenario concludes — so its refusal-detecting power rides entirely on
the scenario's integrity, and **nothing per-push pins that mutation direction.**
When you wire a gate to an external scenario, ask what pins the _scenario_. Fixing the gate's tautology
does not fix an unpinned oracle one layer down.

## 📢 REPORT PLAN ERRORS THAT ONLY AFFECT THE PLAN — not just ones that changed your work

An executor found five errors in an orchestrator plan. It reported the **three that changed what it
built** and silently fixed the **two that only made the plan incoherent** — a self-contradicting verdict
definition, and an instruction that would have made the probe crash on its own headline finding.

Its own diagnosis, which is the rule: _"I reported the three errors that changed my work and missed the
one that only changed yours; that's the wrong filter."_

**A silently-fixed plan leaves the author believing it is coherent, and the next agent inherits the same
trap.** Report every defect you find in your instructions — especially the ones you routed around.
Put the resolution **in the artifact** (a code comment at the decision point, a line in the transcript),
not only in your report.

## ⚖️ SAY WHEN A FIX RESTORES INTENT RATHER THAN PROTECTION

Asked to name a closeable coverage gap, an agent added a caveat nobody requested: the adjacent
measurement showed the mechanism **does not bind on this engine anyway**, so closing the gap restores
the _intended_ defence-in-depth, **not an effective one**.

That distinction is the difference between "ship the fix and you are protected" and "ship the fix and
your configuration finally means what it says". **Both are worth doing — conflating them oversells the
remedy**, and an oversold remedy is how a control ends up trusted and inert.

## 🎯 MUTATION-TEST YOUR JOB-LOG COMPARER FOR RIGHT-COUNT/WRONG-FILE

A per-push proof compared test counts across job logs and mutation-tested the comparer **three** ways:
falsified count, moved line, and — the one nobody thinks of — **right count, wrong file**. `21 tests`
occurred at **two different lines** in the same log, so a comparer keyed only on the count would have
matched the wrong suite and reported success. All three caught.

Also worth copying: that proof included a **control row** — a suite whose count stayed `21 → 21`,
proving an adjacent annotation was comment-only. A count that _should not_ move is evidence too.

## 🧱 A FAILED BUILD DURING A PROBE MEANS CONNECTOR LEGS RAN ON STALE `dist`

Probe A deleted a check, which made the build **exit 2** (unreachable code). The suite still ran — on
the **previous** `dist` — so the cross-package legs measured the unmutated code. The agent noticed,
redid it with a compiling mutation (A2), and **reported both numbers**.

**Check the build's exit code, not just the test output.** A mutation that does not compile gives you a
measurement of the old code wearing the new code's label.

## 🔴 `npm run check:e2e-types` IS RED ON `origin/main` (found 2026-08-05)

25 pre-existing `DispatchAttemptOptions` errors in `e2e/matrix/orchestration`, reproduced on a stashed
tree. It is `&&`-chained **4th** in its script, so it short-circuits before most projects — and
`release-e2e.yml:198` would **fail today**. Not caused by any current PR. If your work touches `e2e/`,
typecheck your projects **individually**; the aggregate script will not reach them.

> **Corrected 2026-08-07 (closeout batch G) — this section is now HISTORY. The text above stays
> verbatim.** Both halves of it have stopped being true. The 25 errors were fixed by PR #109, and the
> `&&` chain is gone: `scripts/check-e2e-types.mjs` runs each project independently and reports every
> failure, so one red project can no longer conceal the seven behind it — which was the bigger of the
> two findings and is the part that cannot recur silently. Re-measured at `ed999b9`:
> `PASS — 8 project(s) typechecked clean`, and independently in three separate batch transcripts this
> wave. **One precision, or this gets re-opened:** the check typechecks `e2e/` against the workspace's
> built `dist/`, so on a stale build it reports failures that are a build-state artifact rather than a
> regression. `release-e2e.yml` runs `npm run build` in the step immediately before it. If you see it
> red, build first and re-measure before writing it down.

## 💸 BOUNDING A SUBAGENT-SPAWNING TEST — and why `--max-turns` is NOT the answer

**Measured overspend, 2026-08-05.** A 12-turn cap was honoured by the ledger's convention
(`result.num_turns`: ~8) and **breached in substance: ~58 model round trips served** — independently
recounted from the engine's own session transcripts as **exactly 51 distinct subagent `requestId`s**
(Glob 5 + Read 44 + Grep 1 = 50 tool calls, plus the answer) behind ~2 parent turns, plus 5 for the
other probe. Cause: a `Task`-spawn's cost lives in a **nested subagent whose turns never reach the
top-level `num_turns`**.

⚠️ **CORRECTION (this brief said "use `--max-turns`" — that is wrong, and measured wrong.)** The flag
does parse (hidden from `--help`), but `num_turns` and max-turns enforcement read **the same top-level
loop counter**, while subagent loops carry their **own** `maxTurns` from agent frontmatter (built-in
default 200). The parent spent ~2 top-level turns, so a process-level `--max-turns 12` would very likely
**not** have stopped the 51 nested round trips.

**What actually bounds it:**

- **`maxTurns:` in the subagent's own frontmatter** (e.g. `packages/plugin/agents/eo-explore.md`, which
  today pins only `model:`).
- **`--max-budget-usd`** — the CLI's documented cost bound.
- **Kill the process GROUP** on timeout. Killing the wrapper did **not** kill the engine beneath it: the
  orphan kept spending **48.8s** past the kill (measured to the second).
- **A bounded prompt.** "Count the files" in a monorepo sent all ~50 calls into `node_modules`.
- **Pin the model.** That run's parent used the host default, not the tested one.

⚠️ **Treat "my wrapper timed out" as UNKNOWN cost, never bounded cost** — the wrapper's ledger recorded
**no entry** for the call its own timeout killed.

**Cost calibration, because round trips ≠ dollars:** 51 of the ~58 ran on **haiku** (pinned in the
subagent's frontmatter), ~2 on opus, 5 on sonnet. The breach is real in round trips and mostly
cheapest-model traffic in money. Report both.

## 🔀 THE HOST `claude` ON `PATH` HAS DRIFTED TO 2.1.221 — outside the accepted range

Accepted range is `2.1.207`–`2.1.220`. Any live suite that resolves `claude` from `PATH` will run
**outside** the range unless you pin it. Fetch `@anthropic-ai/claude-code-linux-x64@2.1.218` into scratch
and put it first on `PATH`; verify the owner's `~/.claude` config is byte-unchanged afterwards (md5 the
files before and after — one pass did exactly that, 6/6 unchanged).

## ✅ A SUBJECT CAN HOLD WHILE ITS TEST FAILS — and the box still stays unticked

A live spawn case went RED on its **own 120s timeout** (`120064ms`), not on an assertion, in a run that
needed ~185s. The engine transcript proved the behaviour worked (`spawnDepth: 1`, the parent naming the
subagent). **The subject held; the test did not.**
Correct handling: record that the subject held, file the test's defects (tight timeout, unbounded prompt,
no model pinned), fix **neither** the test nor the manifest to force a pass, and **leave the box unticked
because the criterion names the suite and the suite is not green.**

## ⚪ WARN-BLIND PROBE CHANNELS — silence only discriminates if the channel speaks for a POSITIVE CONTROL

_(Added 2026-08-07.)_ A probe that reads "the tool printed no warning, therefore the value was
accepted" is worthless unless you have first shown the channel prints a warning for a value you KNOW
is invalid. Measured: `claude plugin details` surfaced **no warning at all** even for a deliberately
invalid `maxTurns: banana`, so its silence for a valid value evidences nothing about whether the
value was read. Before treating a channel's silence as a measurement, drive a positive control
through it and see it speak. If it will not, say the channel is warn-blind and go find one that
reaches the loader's own warn output.

## 🎨 STRIP ANSI ESCAPES BEFORE ANY JOB-LOG BYTE COMPARISON

_(Added 2026-08-07, appended to the one-space rule above.)_ Vitest's per-file
`✓ … (N tests)` lines in a GitHub job log are **ANSI colour-coded**. So
`grep 'test.ts ('` over the raw log returns **zero** — a smaller answer with no error, the exact
instrument-failure shape this file already records for mis-scoped pathspecs and notation-blind greps.
One pass published "this repo's CI prints only the repo-wide summary, there are no per-file lines to
byte-compare" **as a measurement** on the strength of that zero, and it was false; the lines were
all there. Two agents in one wave were misled by it, in opposite directions.

```
sed -E 's/\x1b\[[0-9;]*m//g' joblog.txt | grep 'test.ts ([0-9]* tests)'
```

Strip first, then compare, then quote. And re-read the earlier rule with this in mind: the one-space
form is correct **after** the escapes are gone, not before.

## 🧬 MUTATE THE NOTATION, NOT ONLY THE VALUES

_(Added 2026-08-07.)_ An instrument can pass a battery that exercises every one of its RULES and
still be systematically blind in its **association grammar**. Measured: a citation resolver passed a
three-way mutation battery (falsified quote text, moved marker, marker past EOF) and was
simultaneously blind to every prose-separated quote — its marker-to-quote pairing required the quote
to follow the marker immediately, so `:28-30 says so ('…')` and `:57 proves … — '…'` fell through
unchecked — and to every **bare marker**, which carries no quote at all and was therefore never
span-checked. All three mutations happened to land on markers in the adjacent form, so the battery
tested the rules and never the grammar that feeds them. The published finding count was an
understatement by more than a factor of three.

**When you mutation-test a text instrument, mutate how the thing is WRITTEN — separator, ordering,
punctuation, an entry with the optional half missing — not only what it says.** And when an
instrument's own limitations section names none of its grammar assumptions, that section is not a
limitations section.

## 🚫 NEVER RUN `git push` AS A BACKGROUND HARNESS TASK

_(Added 2026-08-07.)_ A backgrounded push runs the repository's `pre-push` hook, which runs the
suite — and the harness's task lifecycle can kill the process group out from under it. The hook then
reports a failure that looks exactly like a load flake, and the push silently did not happen. Two
things go wrong at once: you chase a test that was never failing, and you believe you pushed.

Detach with `setsid`, or push in the FOREGROUND and wait for it. And whenever a pre-push hook failure
looks like a flake, check first whether the push was backgrounded — the same shrug this file warns
about for real flakes applies here, and here it is hiding a missing push rather than a regression.

### ⚠️ AMENDED 2026-08-07 — `setsid` IS NOT SUFFICIENT, AND THE FAILURE IS SILENT

The paragraph above stays verbatim and its detection heuristic does not cover the mode that was then
observed. It keys on **"a pre-push hook failure that looks like a flake"**. Measured on PR #133:

```
$ setsid git push -u origin <branch> > push.log 2>&1
                                            # exit 0, push.log EMPTY
$ git ls-remote --heads origin <branch>
                                            # (no output — the ref is not there)
```

`setsid` returns as soon as it has forked. **Its exit code is `setsid`'s, not the push's**, so a push
whose hook is still running — or that is later killed — reports success and writes nothing. There is
no failing test, no red hook, no error line. Nothing looks like a flake, because nothing looks like
anything. The prescription above was followed and the push still did not happen.

**The rule, and it is the only one that actually caught this: VERIFY BY REF, NEVER BY EXIT CODE.**

```
git ls-remote --heads origin <branch> | grep -q <expected-sha>   # the only proof
```

A push is landed when the remote says so. Exit status, an empty log and a quiet terminal prove
nothing about a detached process. Poll the ref until it appears; if it never does, the push is still
running or already dead, and only the ref distinguishes those from success.

Corollaries earned in the same pass:

- **`setsid nohup … & disown`** survived where bare `setsid` did not. Redirect stdin from
  `/dev/null` too, or the hook can block on a closed descriptor.
- **A retry does not replace the first attempt — it races it.** Two concurrent pushes of the same
  branch each ran the full suite, on one host, and roughly doubled the wall time of both. Check
  `pgrep -af "git push"` before re-pushing, and kill the orphan.
- **Kill it by PGID, never with `pkill -f`.** `pkill -f "git push …"` matches the harness's own
  `bash -c` wrapper, whose command line contains the pattern — it kills the shell issuing the kill,
  which presents as a bare exit 143 with no explanation. It did so twice here. Use
  `kill -TERM -- -$(ps -o pgid= -p <pid>)` against the specific process group instead. The same trap
  applies to `pkill -f vitest` and `pkill -f 'while :; do :; done'` while a probe script holds those
  strings in its own argv.

## 🔁 KNOWN LOAD-FLAKE LISTS — reconcile the two, they have drifted

_(Added 2026-08-07.)_ This file names two known load flakes above
(`packages/perf/src/measurement/command-runner.test.ts`'s zero-CPU read, and
`packages/journal/src/lease.test.ts`'s `onLeaseLost`/`autoRenew` arms).
`docs/evidence/gap-18/known-gate-flakes.md` catalogues a different set. Cross-referenced in both
directions:

- **The same family, recorded twice under different names:** this file's `lease.test.ts` entry and
  gap-18's `@crabgic/journal` "automatic heartbeat interval actually renews the on-disk record"
  row are the same `autoRenew` real-timer race.
- **In gap-18 and not here:** the git-engine ref-collision row, the perf self-`getrusage` row, and
  the CLI HIGH-H2 overlapping-verification row.
- **In this file and not gap-18:** `command-runner.test.ts`'s zero-CPU read.
- **New this wave, in neither until now — three fast-check property timeouts under concurrent load,
  never assertion failures:** `packages/engine-core`'s footguns property, `packages/gates`'
  coverage-ratchet property, and `packages/engine-claude`'s session property. Seen across PRs #115,
  #116 and #118.
- **Added 2026-08-07 at the v1.6.0 pre-cut gate, and written into both lists in the same pass:**
  `packages/supervisor/src/idle-budget/idle-budget.integration.test.ts`'s sustained-idle arm read
  `cpuFraction` 1.196% against its <1% budget in a full `npm test` taken straight after
  `npm run build`, then passed **3/3 in isolation**. Same family as the rows above — a real
  wall-clock window a co-tenant build stretches past its tolerance — and, unlike the three
  fast-check timeouts, it was re-run in isolation, so it is a verdict rather than a catalogue entry.

- **Amended 2026-08-07 after review of PR #133 — the bullet above states the wrong mechanism, and it
  is left verbatim.** A **fourth** breach of that arm was observed during that review at **1.0137%**,
  in a full-suite run under concurrent external load. Two more were reported at 1.075% and 1.159%
  with no transcript, run id or row anywhere in the tree — **UNVERIFIED**, and nothing rests on them.
  What the bullet gets wrong is "a co-tenant build stretches past its tolerance": `vitest.config.ts`
  sets no `pool`, so Vitest 4.1.10 resolves `pool = "forks"` with `isolate: true` — every test file
  is its own forked process and the metric is `getrusage(RUSAGE_SELF)`, so no co-tenant build or
  sibling test file can enter the numerator. Machine-level CPU contention **can**, and does:
  3 unloaded runs vs 3 under 32 busy loops on 16 cores gave means 0.0663% → 0.1226%, **1.85× with
  non-overlapping arms**. It is still not sufficient to breach — two full 654-file suite runs under
  those same 32 loops came in at **0.0961%** and **0.1069%**. ⚠️ **And a FIFTH breach was then
  captured first-hand at `1.6977%` — the largest ever recorded for this arm — on a plain
  `vitest run --coverage` full-suite run with NO artificial load** (`pgrep` for the generators
  returned 0; `/proc/loadavg` read `6.47 16.96 20.59`), 3/3 green in isolation immediately
  afterwards. So deliberate contention is **neither necessary nor sufficient**, and the mechanism is
  not isolated. ⚠️⚠️ **Then a SIXTH at `3.2330%` twenty minutes later — 2.7× the 1.196% — in the
  pre-push hook for the commit recording the fifth. Two of three consecutive plain full-suite runs
  on that host breached, unloaded, with the readings GROWING.** Stop treating this as an occasional
  timing flake: at that rate it is a gate that does not work, and a green isolated re-run is not a
  disposition. ⚠️ **A SEVENTH then took TWO tests at once** — `heartbeat-scheduler.test.ts:39` at
  1.0388% and `idle-budget.integration.test.ts:46` at 1.2785% — revealing a **second assertion site**
  with its own private `CPU_BUDGET_FRACTION = 0.01`. Grep for every copy of a THRESHOLD, not just of
  a line number: a remedy applied to one site leaves the other live. The second site had already been
  widened once (300 ms to 2000 ms, `e1eaa31`) and breached anyway. ⚠️ **And the disposition every sighting has used —
  "re-ran in isolation, green" — comes from the noisiest channel there is:** the isolated channel
  spans **11.9×** (0.0277% up to 0.3293% at
  `docs/evidence/phase-05/closeout-c6-idle-budget.txt:20`, isolated with coverage off) yet has NEVER
  breached in 15 captured samples, while the full suite breached in two of five uncontended ones —
  so a green isolated re-run samples a different part of the distribution. Against 1.1×
  for the full suite. **A green isolated re-run does not clear this row.** Filed with a sized remedy
  as `docs/evidence/criteria-closeout/defects/05-idle-budget-arm-not-calibrated-for-its-channel.md`;
  full measurements at `docs/evidence/phase-05/idle-budget-load-sensitivity.txt`.
- **New 2026-08-07, in neither list until now:** `packages/cli/src/daemon/run-dispatcher.test.ts`'s
  "reports a settle-transition failure through `onDriveError` rather than crashing"
  (`expected false to be true`) failed once in the same plain full-suite run as the 1.6977% reading,
  and passed **61/61 three times** in isolation immediately afterwards. A verdict, not a catalogue
  entry. Added to `docs/evidence/gap-18/known-gate-flakes.md` in the same pass.
- **The fast-check family is bigger than the three named above.** Reproduced deliberately in the two
  contended runs just described, rather than seen in passing:
  `packages/engine-core/src/footguns/{property,smuggling,anchor-forms,mcp-deny}.test.ts` and
  `packages/perf/src/stats/decision-engine.property.test.ts` — all timeouts, never assertion
  failures.

  > **Dated correction 2026-08-18.** The sentence above stays verbatim; the state it describes does
  > not. The two private `CPU_BUDGET_FRACTION = 0.01` copies were collapsed into one exported
  > constant in `packages/supervisor/src/idle-budget/resource-probe.ts`. **The ruling this entry
  > teaches is unaffected and is exactly why the collapse happened** — grepping for every copy of a
  > THRESHOLD is what found the second site, and then a third (`e2e/attestation`'s
  > `SUPERVISOR_IDLE_CPU_FRACTION_BUDGET`, deliberately left alone by owner ruling). A guard test now
  > fails if a private copy reappears under `src/idle-budget/`, so this lesson is enforced there
  > rather than only recorded.

Neither list is authoritative on its own. Read both, and add a new sighting to **both**.

## ⚠️ AMENDED 2026-08-07 — §🧹 THE PROSE IS UNCHECKED IS NOW HALF-TRUE

_(Amends `docs/verification-playbook.md:500`, which stays verbatim. This text sits at the end of the
file rather than beside what it corrects; that placement is the second ruling below, and it was
measured rather than chosen for convenience.)_

**What `check:citation-content` falsified.** The sweeper that section asks for was built. Its prose
lane resolves every `path:NN` written in `roadmap/*.md` and in the defect records — 940 references at
`776f593` — so "nothing reads the prose" and "no tool validates" are no longer true of those two
directories. The section's two closing ⚠️ rulings are untouched and still hold: cite `file.ts:345`
and never a bare `:345`, and soften a rule that flags something honest rather than tuning the tool
green.

**What it did not falsify — the residual, and it is the whole of what is left:**

> Its prose lane checks that a `path:NN` exists and is in range — not what is on the line. A citation
> can rot into a blank line and pass.

Two narrower gaps the section's original wording now hides. **Scope:** the lane reads `roadmap/*.md`
and `docs/evidence/criteria-closeout/defects/*.md` and nothing else — this file,
`docs/interface-ledger.md`, every transcript under `docs/evidence/`, and every `path:NN` in a code
comment are still read by nothing at all. **Reach:** 39 of those 940 are bare basenames that resolve
only by guessing; they are counted as `unresolved` and gate on nothing. And of the two mutation tests
the section asked for, **one landed and one did not** — "a line past EOF" is the lane's `past-eof`
tier, while "an identifier occurring nowhere in the cited file" is a content check, and there is
none.

**Measured, not projected.** On PR #133 the check was **GREEN through nine real broken citations.** A
pass inserted **41** lines into this file — re-derived, not counted: the content at its pre-#133
`:922` reads at `:963` today — and one table row into `docs/evidence/gap-18/known-gate-flakes.md`,
then cited the pre-insertion numbers; nine anchors came to rest on blank lines and in the wrong
sections. Every one named a real file at a line that existed, so the gate reported PASS. They were
caught by a human reviewer opening each target line — by no tool, and a rerun of the gate would never
have found them.

⚠️ **That figure is 41, and the first draft of this amendment said 42.** It inherited the number
verbatim from `ff3358c`'s message ("gained 42 lines above old :922") — whose own correction table, on
the very next line, reads `:922 -> :963`. `963 - 922 + 1` counts the anchor line itself. **A
displacement is a subtraction, not an inclusive count**, and a figure copied forward without being
re-derived is the same failure as an anchor trusted without its target line being read. Caught by a
reviewer, in the paragraph whose own ruling is "not by arithmetic".

⇒ **RE-RESOLVE AN ANCHOR BY READING THE TARGET LINE.** Not by arithmetic, and not by a green gate.
Above all when your own edit is what inserted lines above it.

### ⚠️ AN ANCHOR INTO A FILE YOU ARE STILL EDITING IS FIXED **LAST**

From the same pass: one anchor into this file was corrected three times — `:1007`, then `:1009`, then
`:1013` — because each later edit pushed its target further down. Correcting it early was worse than
leaving it alone, because a number that has already been "fixed" stops being re-read. There is one
safe order: **finish every edit to the file, then re-resolve every anchor into it, then commit.**

The settled value came to rest on what was then this file's **final line**, and this amendment —
appended below it — leaves it reading exactly as it did. That is the mechanism rather than luck:
**an append moves nothing, so amend `docs/verification-playbook.md` by appending.** Enumerated at
`776f593`, this amendment's own base, rather than estimated: **26 references point into this file,
from 12 files, and 16 of them target a line further down than §500.** Nine of those sixteen sit
where no correction is available — **six inside frozen `docs/evidence/` transcripts and three inside
test-file comments** — so an insertion in the middle of this file rots all nine permanently, with the
prose lane green throughout. That is the price of writing this amendment at line 500; it is why the
text is here instead, and why line 500 carries only a pointer to it.

⚠️ **And name the cost of that, because it cuts the other way.** This file's convention is in-place
amendment — the `### ⚠️ AMENDED 2026-08-07` block at `docs/verification-playbook.md:904` sits
directly under the paragraph it corrects, which is why a reader meets it. A file amended only by
appending accumulates corrections ever further from what they correct, and a heading pointer is a
weaker guarantee than adjacency. So take **append** as the exception that a measured, uncorrectable
anchor set forces, not as the default: **when nothing below your edit is anchored, amend in place.**
