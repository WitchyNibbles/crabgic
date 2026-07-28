# Gap 18 — implementation roast, round 4 (2026-07-28)

Round 4 reviewed the code round 3 had just produced — the self-link rewrite, the policy
store's new ownership checks, the usability predicate, the workspace scratch derivation
and the queue cleanup. A fresh reviewer, given the earlier findings as already-known.

It extends the loop. Three findings were **working attacks or silently disabled the very
fix they belonged to**, which is the failure mode a roast round exists to catch: code that
looks correct, tests green, and does the opposite of what its comment says.

## Confirmed sound

Recorded so they are not re-attacked:

- **No TDZ in `enqueue`.** `.finally` callbacks are always microtasks, so `const next` and
  `queues.set` complete first even when `previous` is already settled. The
  `queues.get(runId) === next` guard is also correct against a successor registering
  between settle and cleanup.
- **Sibling-prefix and trailing-slash handling in `resolveLinkTarget`** — `sourceRoot + "/"`
  correctly excludes `/home/x/repo-backup`, and `resolve()` strips trailing slashes.
- **`rename` cannot hit `EXDEV` or lose the mode** — temp and target are always in the same
  directory, so the inode and its `0600` survive.
- **`linkEntry` cannot loop or recurse unboundedly** — `lstat` makes directory-symlink
  cycles unrecursable.
- **The `isUsablePathPrefix` regex survived its escaping layer intact** and matches
  `owned-path.ts`'s `GLOB_METACHARACTER_PATTERN` character for character.

## Fixed

| #   | Sev          | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **CRITICAL** | **The policy writer could destroy an arbitrary file.** Temp name was `${path}.${pid}.tmp` — fully predictable — and `writeFile`'s default flag follows symlinks. Pre-planting that name as a link to any file the owner owns made `install` truncate the victim, write the policy into it, and `rename` the policy path into a symlink pointing at it. Victim destroyed, install "successful", product bricked because the loader then rejects its own policy. Now `O_CREAT\|O_EXCL` with a random suffix, and the temp file is removed on failure. |
| 2   | **HIGH**     | **`isUsablePathPrefix(".")` was `true`; containment said it grants nothing.** `.` filters to no segments, and `.every()` on an empty array is vacuously true. So `allowedPathPrefixes: ["."]` — the obvious way to write "the whole project" — passed the doctor with a green grant line and refused every dispatch. Byte-for-byte the scenario this predicate was added to close for `src/**`.                                                                                                                                                     |
| 3   | **HIGH**     | **The self-link rewrite silently disabled itself on any non-canonical path.** It compared a `resolve()`d source root against a `realpath()`d target, so a symlinked home or bind-mount alias made every workspace self-link classify as external — sharing them back to the source checkout, the exact defect the module exists to prevent, failing open while reporting a healthy provision. Also: a relative `CRABGIC_PROJECT_DIR` produced dangling relative targets that `symlink()` still reported as success.                                 |
| 6   | **HIGH**     | **`loadEnvelopePolicy` read the bytes before validating the path**, so the inode checked need not be the inode read. Now one descriptor, opened `O_NOFOLLOW`, validated with `fstat`. The directory's **owner** is checked too — a foreign-owned 0755 directory grants unlink and rename whatever the mode bits say — and a directory-inspection failure reports `invalid`, not `absent`.                                                                                                                                                           |
| 7   | **MEDIUM**   | **A symlinked scope directory fell through to wholesale sharing**, carrying every self-link inside it back to the source. `.bin` had the same problem: its relative links resolved into the source's `node_modules`, including `.bin/crabgic`.                                                                                                                                                                                                                                                                                                      |
| 5   | **MEDIUM**   | **Derived scratch paths were unbounded** — 153 entries on this repo, 1600 on a 200-package monorepo, printed one per line before a single `yes` prompt, pushing the paths and commands sections off the screen. The stated justification was readability; at 153 lines it was the opposite. Now two outputs per package, de-duplicated, capped.                                                                                                                                                                                                     |
| 9   | **MEDIUM**   | **`listTopLevelDirectories` skipped symlinked source directories** (a dirent's `isDirectory()` is false for a link), silently under-granting and in the limit calling a repo with plenty of source "vacuous".                                                                                                                                                                                                                                                                                                                                       |
| 10  | **LOW**      | **`process.getuid?.()`** made every policy fail as foreign-owned on a platform without `getuid` (latent — README pins Linux/WSL2), and under `sudo -E` reported "owned by another account" with a repair step inviting a `chown` clobber. Both are now explicit messages.                                                                                                                                                                                                                                                                           |

## Carried forward, not fixed

**Cross-package imports need a build before the first test.** A workspace package's `main`
points into `dist/`, which is gitignored, so in a fresh worktree the redirected link
resolves to a package with no build output and the first cross-package `import` fails with
`ERR_MODULE_NOT_FOUND`. Nothing orders a build first, so an attempt can fail for this
reason and look like a genuine test failure.

The trade is still the right one — validating against the owner's checkout would be
silently **wrong**, where this is loudly **broken** — but it is a real gap between here and
a first green run, and it belongs to the scheduler's attempt ordering rather than to the
provisioning module. Recorded in that module's own header too.
