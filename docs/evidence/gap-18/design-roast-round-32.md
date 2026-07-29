# Roast round 32 — `O_NOFOLLOW` guards the final component, and only that

Round 31 put every hardened open in the product behind one primitive and proved
the corpus refused every hostile object. Round 32 attacked the assumption the
whole thing rests on: `O_NOFOLLOW` refuses a symlink **at the last path
component**. Nothing in rounds 30 or 31 looked at the components above it, and
every one of those writers reached its file through
`mkdir(dirname(path), { recursive: true })` — which **succeeds on an existing
symlink-to-directory**.

## Finding 1 (HIGH) — a symlink one level up handed over the signing key

Planted `<state>/crabgic/<hash>` as a symlink to an attacker-owned directory and
drove the real exported writers:

```
signing key path : .../state/crabgic/deadbeefdeadbeef/approval-signing.key
outcome          : ok
in attacker dir  : ["approval-signing.key"]

policy path      : .../state/crabgic/deadbeefdeadbeef/envelope-policy.json
outcome          : ok
in attacker dir  : ["envelope-policy.json"]
```

Neither refused, and neither noticed.

- The first is **the key that mints approval tokens**. An attacker who reads it
  forges approvals — the same outcome round 31's hardlink finding described,
  reached by a route round 31's fix does not touch.
- The second is the **standing authorization**: the artifact that decides what
  runs _without review_, now sitting in a directory the attacker can also
  rewrite.

Round 30 moved these paths to the XDG state root arguing it "is not
world-writable". Round 31 hardened the final component. Neither addresses a
symlinked **parent**, and the two rounds' own docblocks read as though they had.

## The fix, and the trade-off it deliberately makes

`ensureOwnedDir(dir, trustedRoot)` in the shared primitive: walk every component
**below** `trustedRoot`, `lstat` each (never `stat` — the point is to see the
link rather than what it points at), create the missing ones `0700`, and refuse
a component that is a symlink, is not a directory, is owned by another account,
or is group/world **writable**. Write permission only: a readable state
directory is a lesser problem than one another account can replace entries in.

**The root itself is not verified, on purpose.** A symlinked `$HOME` or
`$TMPDIR` is a normal configuration on several platforms, and refusing it would
break working installs to close an attack that already needs write access to a
directory Crabgic itself creates `0700`. That is the shape of net-negative fix
rounds 4–8 kept catching, so the exemption is pinned by its own test rather than
left as a comment.

**Re-measured after:** both writers refuse, and the attacker's directory is
**empty** — a refusal that still wrote would be the defect wearing a different
verdict, so that is asserted rather than assumed.

## What the suite caught that the probe could not

The first version of `ensureOwnedDir` walked from the root without **creating**
it. On a fresh machine `$HOME/.local/state` does not exist, so the first `mkdir`
below the root failed `ENOENT` and **every first run refused to start**.

Eleven `bootstrap.test.ts` cases failed. The probe passed — because the probe
staged a root that already existed, which is the difference between an attack
scenario and a first run. A hostile corpus tests the adversary's paths; only the
suite tests the ordinary one, and a security fix can break the ordinary path
without touching a single adversarial assertion.

The root is now created recursively and unverified, exactly as before, and a
regression guard asserts a fresh `$HOME` with no `.local/state` still
bootstraps.

## Methodology — stale `dist` produced a convincing false diagnosis, twice

Round 31 recorded that a mutation battery poisoned `packages/journal/dist`.
Round 32 hit the same class from the other direction, with no battery involved:

> **`packages/cli`'s tests resolve `@crabgic/journal` to its BUILT output, not
> its source.** A change to a journal source file is invisible to every cli test
> until `npm run build` runs.

After fixing `ensureOwnedDir` to create the root, the journal's own tests went
green while the eleven bootstrap tests kept failing with the _identical
pre-fix error message_. That reads exactly like "the fix does not work". It was
"the fix is not present": one rebuild turned 11 failures into 52 passes with no
source change at all.

Both incidents share one rule, now stated once:

> **Establish which artifact the failing call actually executed before believing
> any diagnosis.** In this repo, cross-package edits are not live until a build.

The generalisable form: a monorepo where tests resolve siblings through built
output has a silent staleness window, and inside it a green suite and a red
suite are equally uninformative.

## Corollary — a guard test caught a comment, and was right to

`policy-store.test.ts` greps the repo for the policy writer's identifier to
prove it has exactly one call site (Ledger Gap 18 part 3). Adding a docblock in
`owned-open.ts` that merely _named_ the writer failed it.

That is a false positive in the literal sense and the guard is still correct:
it is deliberately broad enough to catch an aliased import, which a
call-shaped grep (`writeEnvelopePolicy(`) would miss. The comment was reworded
to describe the writer indirectly rather than the guard loosened — the guard is
worth more than the convenience of spelling the name.

## Two of round 32's own tests were wrong first

`mkdirSync(dir, { mode: 0o777 })` does not produce a `0777` directory: the
umask reduces it to `0755`, so `mode & 0o022` is zero and the
"group-or-world-writable" assertion passed for the wrong reason — it was
asserting against a mode the directory did not have. Round 6 found precisely
this class in the policy store ("a mode the directory does not even have"), and
it reappeared in a test written to check for it. Fixed with an explicit `chmod`
after the `mkdir`.

The other was an import that a `python` rewrite silently failed to apply, which
surfaced as `ReferenceError` rather than as a wrong result — the harmless
failure mode, and worth contrasting with the umask one, which was silent.
