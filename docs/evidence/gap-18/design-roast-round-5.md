# Gap 18 — implementation roast, round 5 (2026-07-28)

Round 5 reviewed the round-4 fixes. It **confirmed the critical one held** and found ten
more, two of which were earlier fixes applied to one call site and not its sibling.

## Confirmed sound — the round-4 critical is genuinely closed

The reviewer executed the code rather than reading it:

- **The temp-file symlink attack is dead.** `rename(2)` does not follow a symlink at the
  target: the pre-planted link was replaced and the victim file left intact. With
  `O_CREAT|O_EXCL` and an 8-byte random suffix there is no remaining predictable-name or
  link-following primitive. `mkdir` over an existing _file_ throws `EEXIST` loudly.
- **`readFileSync(fd)` reads from position 0** — `fstatSync` does not move the offset.
- **No fd leak on any path**, including the early return; the `finally` encloses it.
- **`O_NOFOLLOW` plus a symlinked parent is contained** — the parent must still resolve to
  an owner-owned, non-group-writable directory, which an attacker cannot produce.
- **`realpath` on both sides genuinely fixed the symlinked-`sourceDir` fail-open.**
- **`worktreePath` nested inside `sourceRoot`** produced no wrong answer.

Perf (a `realpath` per entry) was measured, found trivial, and **dropped rather than padded
into a finding** — which is the behaviour the roaster instructions ask for.

## Fixed

| #   | Sev          | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **HIGH**     | **The scratch list and the provisioner's directory list had drifted apart.** Round 3 added `.vite`/`.vite-temp` to `WORKTREE_LOCAL_MODULE_DIRS` and left the deriver granting only `node_modules/.cache` — which this repo does not have. So provisioning anchored a directory nothing uses and omitted the two vitest writes to on every run, breaking one of the only two grantable commands that work. Parity is now asserted by a test reading the other package's constant. |
| 2   | **HIGH**     | **The round-4 absolute-path fix was applied to one return and not its sibling.** `resolveLinkTarget`'s dangling branch still returned a bare `sourcePath`, three lines above a `resolve(...)` under a comment explaining why absolute is mandatory. A relative `CRABGIC_PROJECT_DIR` produced targets resolving against `<worktree>/node_modules/`, dangling, and counted as linked rather than skipped.                                                                         |
| 3   | **HIGH**     | **`.bin` recursion failed open in the ordinary case.** Round 4 added it; round 5 showed it is worse. A workspace `.bin` entry points at `../<pkg>/dist/<bin>.js`, absent in an installed-but-unbuilt checkout — so `realpath` threw, the dangling branch shared it back to source, and the moment the owner built **their** checkout the worktree's binaries resolved to the owner's files. This module's headline failure, reintroduced order-dependently. **Reversed.**        |
| 4   | **MED-HIGH** | **Following symlinks widened write grants outside the repo.** Git tracks symlinks, so a checked-in `packages/etc -> /etc` is reproduced by `git worktree add` and derived `packages/etc/dist` as a sandbox write grant — turning a dormant unprobed question about the engine's symlink resolution into a live one driven by repo-controlled content. Under `packages/`/`apps/` there is no name allowlist to bound it.                                                          |
| 5   | **MEDIUM**   | **The cap returned from the whole function mid-container**, so 45 packages plus 3 apps granted every package and **nothing** for apps, with no marker in the policy an owner reads. The test only ever exercised one container.                                                                                                                                                                                                                                                  |
| 6   | **MEDIUM**   | **A directory at the policy path reported `absent`**, then `install` crashed renaming over it. It opens fine under `O_RDONLY\|O_NOFOLLOW` and passes every ownership check before throwing `EISDIR` on read.                                                                                                                                                                                                                                                                     |
| 7   | **MEDIUM**   | **An unreadable policy reported `absent` too**, inviting `install` to overwrite a file the owner deliberately locked. The absent/invalid split is documented at length precisely to prevent this.                                                                                                                                                                                                                                                                                |
| 10  | **LOW**      | **Cap selection was `readdir`-order dependent**, so the same repo derived a different policy — and a different authorization digest — on different machines.                                                                                                                                                                                                                                                                                                                     |
| 9   | **LOW**      | **`isUsablePathPrefix("./~")` was `true`** while containment collapsed it to `~` and granted nothing — the sibling of the `"."` case the empty-segment guard had just closed, in a function whose doc promises one shared answer.                                                                                                                                                                                                                                                |

## The pattern this round makes plain

Two of ten findings were **earlier fixes applied incompletely** — one return statement
updated and not its sibling, one constant updated in one package and not the package that
consumes it. Neither was catchable by re-reading the file that was changed; both needed a
reader looking at the _other_ end. That is the specific value a fresh adversarial reviewer
adds over re-reading one's own diff.
