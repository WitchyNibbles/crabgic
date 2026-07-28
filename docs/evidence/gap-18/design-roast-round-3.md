# Gap 18 — implementation roast, round 3 (2026-07-28)

Rounds 1 and 2 covered the design and the first implementation. This round covered code
none of them had seen: the worktree dependency provisioning, the `transitionRun`
serialization, the policy store and derivation, and the doctor check. A fresh reviewer,
told which earlier findings were already known so it could not extend the loop by
restating them.

It extends the loop, and it is the strongest round so far — two findings would have made
the product actively wrong rather than merely broken.

## Confirmed sound

- **`deriveCommands` cannot produce a wrong grant.** `granted` only ever holds members of
  `GRANTABLE_COMMAND_PREFIXES`, so the filter is a pure reorder. `readPackageScripts`
  survives `scripts: null`, `"str"`, `[]`, and `__proto__` keys.
- **`.then(work, work)` is correct.** The rejection handler returns a fresh promise and
  chain ordering holds; a failed transition does not poison later ones.
- **Two registries over one journal is unreachable.** `createRunsRegistry` has one
  non-test call site, and `recovery.ts`'s queue-bypassing `upsert` runs at startup
  strictly before the router is wired.
- **The `stat`-after-`read` ordering is not independently exploitable.** The real gaps
  were the missing `lstat`, uid and directory checks — see F4.

## Fixed

| #   | Sev        | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F2  | **HIGH**   | **Workspace self-links made every worker validate the wrong tree.** `node_modules/@crabgic/contracts -> ../../packages/contracts` (verified live). Copied verbatim, a worker editing its own copy and running `npm run test` had the tests resolve the **owner's** checkout. Green tests would have been evidence about a tree the worker never touched. Self-links are now redirected into the worktree; scope dirs are recursed rather than linked wholesale.                                    |
| F1  | **HIGH**   | **The narrowed `allowWrite` broke `npm run build` on this repo, unfixably.** Every package sets `outDir: "./dist"`, so `tsc -b` writes `packages/<name>/dist` — uncovered by a top-level `dist` grant, which does not exist here anyway. The obvious repair is a glob, which `validateOwnedPath` rejects and the compiler then **silently dropped**, while the doctor printed it as granted. Derivation now enumerates workspace children as literal paths, and unusable entries no longer vanish. |
| F3  | **HIGH**   | **The doctor passed a policy matching nothing.** `allowedPathPrefixes: ["src/**"]` parsed, was non-empty, and reported healthy while containment refused every dispatch. `is-contained.ts` documents that scenario verbatim; the fix had been applied to its refusal message but not to the vacuity test written afterwards. `isVacuousPolicy` now shares one usability predicate with the installer and containment.                                                                              |
| F4  | **HIGH**   | **No `lstat`, no uid check, no directory check.** `statSync` follows symlinks, so a policy path linking to a 0600 file owned by **another account** passed by validating the target. And `mkdir` does not chmod an existing directory, so a 0777 state root left the policy replaceable regardless of its own mode.                                                                                                                                                                                |
| F5  | **MEDIUM** | **`writeFile`'s `mode` applies only on create**, so writing over a pre-existing world-writable policy put the grant in first and narrowed after — the exact window the code's own comment claimed to avoid. Now temp-file + rename, which is atomic too.                                                                                                                                                                                                                                           |
| F7  | **MEDIUM** | **`JSON.stringify`'s replacer array is a deep key allow-list, not an ordering device.** The first nested field added would have been erased from the digest, so two policies granting differently would digest identically and the journaled authorization identity would be a lie.                                                                                                                                                                                                                |
| F8  | **MEDIUM** | **The write queue leaked exactly the way its comment denied.** `composeSupervisor` creates one registry for the daemon's lifetime, so the `WeakMap` never shed it: one settled promise per run, retained for ever. Cleanup is now part of the awaited promise rather than a detached chain, which is also what makes it testable.                                                                                                                                                                  |
| F6  | **MEDIUM** | **`.cache` was the wrong special case.** This repo has none, and does have `.vite`/`.vite-temp`, which Vite and Vitest write to on every run and which were being symlinked out of the worktree.                                                                                                                                                                                                                                                                                                   |
| F9  | **MEDIUM** | **A Bash-layer guarantee was attributed to every layer.** `engine-baseline.md` §14.2 records that the sandbox does not constrain the engine's `Write` tool at all on the probed host, so "denied regardless of how the engine matches paths" was false for `Write`/`Edit`. The claim is narrowed rather than left overstated.                                                                                                                                                                      |
| F10 | **LOW**    | **Swallowed failures made success indistinguishable from a no-op.** Re-provisioning returned `linkedCount: 0`, byte-identical to "the source had no `node_modules`". Skipped entries are now named.                                                                                                                                                                                                                                                                                                |

## Note on `"junction"`

`fs.symlink`'s `type` argument is Windows-only and ignored on the pinned Linux/WSL2
baseline, so behaviour here was already correct; it is dropped as dead intent. On Windows
a junction cannot target a file, which would have silently lost
`node_modules/.package-lock.json`.

## Still open

Nothing new. The carry-forwards from rounds 1 and 2 stand: the trim asymmetry between
containment and the compiler, file-shaped owned paths compiling to a grant over nothing,
and `requiredCapabilityFlags` having no consumer at apply time.
