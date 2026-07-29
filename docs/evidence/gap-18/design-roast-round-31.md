# Roast round 31 — five openers, two behaviours, and one of them was no answer at all

Round 30 hardened two openers against a planted symlink and a FIFO. Round 31
swept the repo for the rest of the class (`grep O_NOFOLLOW`, and `tmpdir()` uses
that are not `mkdtemp`) and found **three more** using `O_NOFOLLOW` **without**
`O_NONBLOCK`.

Controls first, and they are what make the headline readable: the identical
staging with **no policy file** (rc=2, 1s, 1215 bytes, correct diagnosis) and
with an **ordinary junk file** (rc=2, 1s, 1244 bytes, correct diagnosis).

## Finding 1 (HIGH) — a FIFO at the policy path froze `doctor` unkillably

```
mkfifo $XDG_STATE_HOME/crabgic/<hash>/envelope-policy.json
node packages/cli/dist/bin.js doctor
-> rc=137   wall=36s   output bytes=0
```

Worse than round 30's, in a specific way: `policy-store.ts` uses **`openSync`**,
so the block is on the **main thread**. No timer fires, no signal handler runs —
it **ignored SIGTERM at 30s and required SIGKILL**. Round 30's cursor blocked a
libuv thread; this blocks the interpreter.

`loadEnvelopePolicy` has two live callers. One is a `doctor` check. The other is
**`packages/cli/bin/supervisord.ts`**, the daemon that gates every dispatch.

## Finding 2 (MEDIUM) — the copies had already diverged, and only measurement showed it

A differential over one corpus, **one process per case** — a synchronous block
cannot be observed by any in-process timer, and the first (in-process) harness
hung, which is the proof rather than an inconvenience. Content is schema-valid
per site, so a refusal is attributable to the OBJECT rather than to its bytes;
without that every row read `invalid` and the table discriminated nothing.

| object           | policy-store | signing-key | round 30's opener |
| ---------------- | ------------ | ----------- | ----------------- |
| regular (valid)  | loaded       | ok          | accepted          |
| symlink          | invalid      | threw       | refused           |
| dangling symlink | invalid      | threw       | refused           |
| directory        | invalid      | threw       | refused           |
| mode 644         | invalid      | threw       | (not checked)     |
| **fifo**         | **BLOCKED**  | **BLOCKED** | refused           |
| **hardlink**     | **LOADED**   | **OK**      | **REFUSED**       |

Three implementations, two behaviours, in both rows that matter. The hardlink
row is the one `O_NOFOLLOW` does not cover **at all**: a hardlink opens as a
perfectly ordinary regular file this uid owns, so an attacker who can link a
file they control into the state directory **chooses the signing key**, and
therefore forges approval tokens. Two of three copies accepted one.

This is round 7's lesson verbatim — "three attempts at keeping two functions in
agreement each diverged somewhere new".

## Finding 3 (MEDIUM) — a third site, and a docblock promising what the code did not do

`provisionWorkerAuth`'s credentials destination, driven through the real
exported entry point, one object per process:

| dest object      | before                                  |
| ---------------- | --------------------------------------- |
| absent / regular | ok                                      |
| symlink          | `WorkerAuthError`                       |
| **fifo**         | **BLOCKED**                             |
| directory        | **bare `Error`**, not `WorkerAuthError` |

Its docblock says it "Throws `WorkerAuthError` for a symlink (`ELOOP`) or **any
other non-regular / unreadable dest**". A FIFO is non-regular and was not
refused — it blocked; a directory was refused with the wrong error class, so a
caller catching `WorkerAuthError` to report an auth problem saw an unhandled
crash. Round 30's finding 4 was a comment doing a mitigation's job; this is a
comment doing an error-contract's job.

## The fix

One `openOwnedFile` in `@crabgic/journal`. **Five** call sites converged on it:
`policy-store`, `signing-key`, `sandbox-selftest` (round 30's), `gates/drift`
(round 30's other one), and `engine-claude/auth`.

- `O_NOFOLLOW` refuses a planted symlink **at open time**, closing the swap
  between the check and the read.
- `O_NONBLOCK` is what stops a FIFO blocking in `open(2)`.
- `fstat` on the **descriptor**, so the inode inspected is the inode used.
- `nlink === 1` refuses a hardlink.
- **`O_TRUNC` is rejected outright** — truncation is a write, and it must not
  happen to anything the checks would go on to refuse.

Callers map the refusal onto their own wording, so every owner-facing string
earlier rounds fought over is preserved exactly. The opener reports what it
found (`kind`) and the uid and mode it saw, because a caller that cannot see
those numbers has to re-`stat` the **path**, which reopens the very swap the
descriptor checks exist to close.

Absence became a **return value** rather than an `ENOENT` the signing key's own
caller had to sniff out of a thrown error: a first run with no key is normal.

**Re-measured after:** every hostile row refuses, the control still loads, and
the real CLI answers the FIFO in **2s / rc=2 / 1239 bytes** with a diagnosis
naming it — against 36s / rc=137 / zero bytes before.

## Mutation record

| #   | mutation                            | result                         |
| --- | ----------------------------------- | ------------------------------ |
| N0  | unmutated                           | green control, 111/111         |
| N1  | drop `O_NONBLOCK`                   | **hangs the worker**, exit 124 |
| N2  | drop `O_NOFOLLOW`                   | **hangs the worker**, exit 124 |
| N3  | drop the `nlink` check              | 7 failed                       |
| N4  | drop the `isFile` check             | 7 failed                       |
| N5  | drop the owner check                | 4 failed                       |
| N6  | allow `O_TRUNC` through             | 4 failed                       |
| N7  | ignore `requirePrivateMode`         | 5 failed                       |
| N8  | collapse `absent` into `unreadable` | 5 failed                       |
| N9  | stop naming a directory a directory | 5 failed                       |

**Zero survivors** — the first round since 26 with none. The battery runs the
primitive's own tests **plus all three callers'**, because the claim under test
is that one site decides for all of them; a mutation only its own tests caught
would leave the callers unprotected.

Two results worth naming:

- **N5 died here and its equivalent survived in round 30.** Round 30 recorded
  the owner arm as uncoverable — distinguishing it needs a file owned by a
  different account, and this environment has one uid. Consolidation gave the
  arm coverage it could not have in isolation, because a **caller's** existing
  tests reach it. Merging implementations did not merely prevent future
  divergence; it raised the floor on what is testable at all.
- **N1 and N2 kill by HANGING, not by failing.** A battery that greps for
  "failed" reads both as survived, and one without a per-case timeout stalls on
  the first of them forever.

## Methodology — the battery poisoned a build artifact

Round 30's three harness rules (commit before mutating, verify the restore,
bound every case and reap workers) all held. A **fourth** was found the
expensive way.

While the battery was running, `npm run typecheck` was run in the same
worktree. `tsc -b` **emits**, so it compiled the _mutated_ `owned-open.ts` into
`packages/journal/dist` — and the mutant **outlived the battery**, because the
battery restores source, not build output. The next test run then failed with a
victim file overwritten through a symlink, which read exactly like a real
regression in the fix.

It was not. `openOwnedFile` called from **source** refused the symlink
(`ELOOP`); called from the **built** package it returned a descriptor. The
source was clean, `dist` was not — the poisoned artifact held **3** occurrences
of `O_NOFOLLOW` where a clean build holds **4**.

> **Rule 4: a mutation battery owns the whole worktree, build output included.**
> Run nothing that compiles while one is running, and rebuild afterwards before
> trusting any result that goes through `dist`.

The near-miss is the point: an earlier end-to-end "verification" through the
bundled CLI could have been run against a mutant and read as a pass. The three
green re-attacks in this round were re-run after the rebuild.

Corollary for the loop, not just this repo: **when a fix appears to regress,
establish which artifact the failing call actually executed before believing the
diagnosis.** Two probes settled it in under a minute — the same function, called
from source and from `dist`, gave opposite answers.

## Instrumentation notes carried forward

- A **synchronous** block cannot be raced. `Promise.race` against a timer never
  resolves, because the timer callback needs the event loop the block is
  holding. One child process per case is the only harness that works, and its
  exit code is the measurement.
- `pkill -f <pattern>` and a battery's `reap()` are indiscriminate: reaping
  every `forks.js` killed a _different_ vitest run started alongside it, whose
  "Worker exited unexpectedly" was mistaken for a failure until the collision
  was noticed. Never run the suite beside its own battery.
