# 07 — `SANCTIONED_SCRUB` cannot tell a deliberate control from a forgotten scrub

**Phase:** 07 — Git control repo and worktrees (`roadmap/07-git-control-repo-worktrees.md`, the
ambient-`GIT_DIR` containment work). No exit criterion: the guard is a repo-wide hygiene control
rather than a criterion's named bearer.

**Found:** 2026-08-07, post-v1.6.0 review, at `5b10f1e257a5ae835fb5edbba1cf3b8e87ca6744`
(`origin/main`), by carrying out the corollary that `docs/verification-playbook.md:664` states and
does not itself perform: "grep the exemption tokens across the tree and ask which matches are prose."

**Severity:** latent. **Nothing is unsafe today** — the one file this finds is exempt while doing
something deliberate and harmless, and that is measured below rather than assumed. The defect is that
the guard has no way to distinguish that file from one whose author simply forgot, so the exemption
is invisible in both the honest and the dishonest direction.

**Effort: S** for the smaller of the two remedies. Sized below.

## The mechanism

`packages/testkit/src/git-spawn-hygiene.test.ts:112`:

```ts
const SANCTIONED_SCRUB = /runFixtureGit|gitFixtureEnv|GIT_LOCATION_ENV_VARS/;
```

and `:145`, inside the repo-wide walk:

```ts
if (SANCTIONED_SCRUB.test(text)) continue;
```

`text` is the file's **whole** source, comments included. Naming any of the three identifiers
anywhere in a file exempts it from the mutating-git-spawn rule entirely.

This is documented, accurately and at length: a one-line warning at `:111` and a **47-line** footnote
block at `:207-253`, both added earlier the same day, plus a playbook section. (Corrected 2026-08-07
before merge: an earlier draft said "40-line". The block opens at `:207` and runs to the end of the
file at `:253`. Its own text at `:213` says "a 30-line comment", which refers to the comment that was
_proposed and rejected_ for the definition site, not to itself.) **Documentation is not a
control**, and the mechanism is unchanged by any of it — which is precisely why this is filed rather
than considered closed by that prose.

## The pre-existing instance

A census over the guard's own walk (`SCANNED_ROOTS`, `SKIP_DIRS`, the five scanned extensions, the
guard's own file excluded exactly as it excludes itself), comparing each file's token count against
its count after comments are stripped:

```
files matching SANCTIONED_SCRUB anywhere:                 20
  of which PROSE-ONLY (never outside a comment):           1
```

The one is `packages/git-engine/src/plumbing.test.ts`. Its single match is at `:133`, inside a block
comment opening at `:132`; it has no `@crabgic/testkit` import at all and never uses any of the three
identifiers as an identifier. Its mutating spawn is at `:201`, inside a case introduced at `:196`:

> `it("CONTROL: the same write on an unscrubbed spawn DOES land in the poisoned repo instead", …)`

⚠️ **That spawn is benign and is supposed to be unscrubbed.** It is a deliberate negative control in a
hermetic two-repo fixture, and it sets `GIT_DIR` **on purpose**, to demonstrate that the scrub its
sibling test applies is load-bearing. **No unsafe behaviour is claimed anywhere in this record.**

Note also what the census does _not_ find: `scripts/check-marketplace-pin-digest.mjs`, the playbook
section's own subject, is correctly absent — PR #131 de-tokenized its `DO-NOT-REFACTOR` note, so it no
longer matches. The instance here is older and independent of that one.

## Measured — four reverse probes

Command: `npx vitest run --project @crabgic/testkit src/git-spawn-hygiene.test.ts`.

| probe                                                                | result                       | should be |
| -------------------------------------------------------------------- | ---------------------------- | --------- |
| A. baseline, tree untouched                                          | 4 passed (4)                 | green ✅  |
| B. add `git reset --hard HEAD~5` at `cwd: "/"` to `plumbing.test.ts` | **4 passed (4)**             | red ❌    |
| C. probe B's spawn **and** the comment de-tokenized                  | 1 failed \| 3 passed (4)     | red ✅    |
| D. pristine file, **only** the comment de-tokenized                  | **1 failed \| 3 passed (4)** | —         |

**Probe D is the finding.** With nothing else changed — no spawn added, the file exactly as
committed — removing one word from one comment makes the guard flag it:

```
AssertionError: expected [ Array(1) ] to deeply equal []
+   "packages/git-engine/src/plumbing.test.ts",
```

So the exemption is doing real work at HEAD, not sitting latent. And probe B is what it costs: an
outright destructive spawn added to that file today is invisible, because of a word sixty-eight lines
above it.

## Proposed remedy

Two options. They are not alternatives to each other so much as a cheap one and a thorough one.

1. **An explicit opt-out marker, and require the token outside a comment.** Add a recognised
   annotation — e.g. a `// git-spawn-hygiene: deliberate-unscrubbed-control — <reason>` line the
   guard accepts as a _second, distinct_ exemption path — and narrow `SANCTIONED_SCRUB` so a prose
   mention no longer qualifies (comment-strip before testing, or require the token adjacent to a
   call/import). `plumbing.test.ts:196` then carries the marker and says out loud what it is doing;
   every other exempt file keeps its exemption for the right reason. Failing-first test: probe B,
   which must redden. **Effort: S** — one regex, one marker, two assertions in the guard's own suite,
   one comment in `plumbing.test.ts`.

   ⚠️ Two things to measure before landing it, both of which the playbook's own coverage-migration
   ruling demands: (a) re-run the census after the narrowing and check that none of the other 19
   matching files loses its exemption for a reason its author did not intend — several have counts
   that drop under comment-stripping (`git-repo-state.ts` 3→2, `plumbing.ts` 4→2,
   `crabgic-statusline.mjs` 4→2) and must still qualify on their remaining uses; (b) the guard's own
   `the guard is not vacuous` case (opened at `git-spawn-hygiene.test.ts:194`) asserts
   `expect(scrubbed.length).toBeGreaterThanOrEqual(5)` at `git-spawn-hygiene.test.ts:201`, so
   narrowing moves that number and the assertion has to be re-derived from a measurement rather than
   adjusted to fit.

2. **Drop presence-matching for the tests.** For test files, require the actual import
   (`runFixtureGit`/`gitFixtureEnv` from `@crabgic/testkit`) rather than the string. This is stronger
   and it is what the guard's readers already believe it does. It does **not** cover the two
   zero-dependency production sites that can only reference `GIT_LOCATION_ENV_VARS`, so it is a
   complement to option 1, not a replacement. **Effort: M** — needs the two production sites carved
   out explicitly, and every currently-exempt test file re-checked.

Option 1 alone closes the recorded defect. Option 2 is the direction to move in if this recurs a
third time.

**Ticket-ready:** yes.

## Not claimed

- **Not claimed:** that any current spawn in this repository is unsafe. The one instance found is a
  deliberate negative control, and this record says so before it says anything else.
- **Not claimed:** that presence-not-proof was the wrong trade. `git-spawn-hygiene.test.ts:26` calls
  it "presence, not proof — enough to make the omission loud", and the playbook rules it a deliberate
  and documented cost. The gap this record names is narrower: there is no way to _say_ "deliberately
  unscrubbed, and here is why", so the only way to say it is the same string that switches the rule
  off.
- **Not claimed:** that the census's comment-stripping is exact. It is a regex pass over `/* */` and
  trailing `//`; it produced one candidate and that candidate was then confirmed by execution (probes
  C and D), not by the strip.

**Evidence:** `docs/evidence/phase-07/sanctioned-scrub-presence-exemption-probes.txt`.
