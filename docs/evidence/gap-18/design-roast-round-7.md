# Gap 18 — implementation roast, round 7 (2026-07-28)

Round 7 reviewed the round-6 fixes by **executing and measuring** them. It found that the
round-6 path-prefix fix had made the problem it addressed **six times worse**, and that two
`.bin` treatments in a row had each been strictly worse than the one before for trees they
had not been tested on.

## The measurement that mattered

Brute-forced 51,911 prefixes against the containment normalizer:

|               | usable-but-grants-nothing | unusable-but-normalizes | total    |
| ------------- | ------------------------- | ----------------------- | -------- |
| after round 5 | 1143                      | 0                       | **1143** |
| after round 6 | 90                        | 6805                    | **6895** |

The round-6 commit claimed it closed 113 mismatches "all needing a whitespace-leading first
segment". Ninety of the same dangerous class survived — a whitespace-only **interior**
segment does it — and the trim introduced 6805 in the reverse direction.

**Structural fix rather than a fourth attempt at agreement.** Rounds 4, 5 and 6 each kept a
boolean predicate in step with the containment normalizer by re-deriving the same rules, and
each diverged somewhere new: `"."`, then `"./~"`, then `"./ /src"`. Two functions that must
agree will not, however carefully each is written. `normalizePathPrefix` now lives in
`@crabgic/contracts` and `@crabgic/engine-core`'s containment check calls it, so
`isUsablePathPrefix(p) === (normalizePathPrefix(p) !== undefined)` holds by construction.

## Also fixed

- **`.bin` shim files were silently dropped.** `readlink` raises `EINVAL` on a real file, and
  npm writes real shims for some entries. They vanished — and not into `skipped` either, so
  a tree whose bins are shims got an **empty** `.bin` and `npm run test` had no binary at
  all. Round 5's wholesale share handled this; round 6 did not. This is the third `.bin`
  treatment and the first that handles both shapes.
- **An absolute-target `.bin` link gave two answers for one package**, which is precisely
  what the treatment exists to prevent, and which `resolveLinkTarget` already got right for
  package entries.
- **The `node_modules` exclusion failed when `node_modules` was itself a symlink** — a shared
  store, bind mount or docker volume, the very layouts round 6 cited as its reason for
  allowing external links at all.
- **`ENOTDIR → absent` undid a sibling fix in its own commit.** A state root that is a
  regular file raised `ENOTDIR`, "absent" routed the owner to `install`, and the writer then
  died with a raw `EEXIST`.

## Attacked and could not break

- **The round-robin cap.** Total is exactly 40 across eleven shapes including 60/1, 1/60,
  3/45, 39/39, 0/60 and 200/200; no container starves unless it is empty; deterministic and
  insensitive to listing order. The round-5 waste and the "one `apps/` dir halves packages"
  regression are genuinely fixed.
- **`isDirectory()`-first ordering in `policy-store`** misreports no real policy file.
- **`.bin` relative links**, external and workspace, resolve consistently with the sibling
  package link.
- **`list-directories` on symlink chains, `.git`, `.git/modules/*` and `./x/./y` forms.**

## Seven rounds

Rounds 1–3 found defects in new code. Rounds 4–7 found defects in **fixes**, and rounds 6
and 7 each found that a previous fix was net-negative — measured, not argued. The termination
rule ("a round finds nothing novel and falsifiable") has still not been met, and the reason
is worth stating plainly: a fix is a change, and changes need review as much as the code
they replace.
