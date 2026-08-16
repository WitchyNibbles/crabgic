# The completed run published work nobody verified

**2026-08-16, run `04a0bf70`.** The same run recorded in `first-completed-run.md`
as the first to reach `published_local`. This document is the other half of that
result, and it is the more important half.

## The two facts

**The worker could not run a single command.** It tried twelve times. Every
`Bash` call failed with `Failed to create bridge sockets` — the engine's command
sandbox never initialized on this host. The envelope granted `npm run test`,
`npm run build`, `git status`, `git diff`; none of them executed, in this run or
in run 97fb3b10 before it.

**The result it self-reported was a placeholder**, verbatim:

```json
{ "outcome": "succeeded", "summary": "test", "diagnostics": ["test"] }
```

A summary of `"test"` and a diagnostic of `"test"`. That document satisfied
`WorkerAuthoredResultSchema` — `summary` is a non-empty string, `diagnostics` is
an array of non-empty strings — and the run integrated and published on it.

## What that means

The work unit declared eight acceptance criteria, three of which required a test
to exist and pass. **Nothing checked any of them.** Specifically:

- the criteria SEAL verifies the criteria were not rewritten between approval and
  completion. It is an anti-tamper check, not an acceptance check, and it passed
  correctly — nothing was tampered with;
- the gates registered at `final_verifying` are the criteria-seal gate and the
  security-fixture manifest. Neither asks whether this change set's own
  acceptance criteria were met;
- phase 14's tdd/coverage/flake/scanner tranche, which is what would ask, has no
  production registration (`docs/deploy-posture.md`, gate-registry row: "whether
  they fire in the daemon is an owner scope decision");
- the staged review pipeline's `implement-task-done-criteria-met` obligation
  belongs to a review round, and no review round ran.

So the pipeline's terminal state means **"a worker claimed success and its diff
merged cleanly"**, not "the work was verified". Those are very different claims,
and today only the first is earned.

The code this particular worker wrote happens to be good — it was read by hand
afterwards. That is luck, and luck is not a control.

## Why this is the finding that matters

This repository's whole discipline is about refusing vacuous evidence: a
universal quantifier over an empty set, a test whose assertion cannot fail, a
green suite agreeing with a defect. This is that same failure arriving at the
**top level of the product**, where it is worth more than any of the five
defects fixed today:

> A run reports `published_local` — the strongest thing the system can say — on
> the strength of a worker asserting `"summary": "test"` about work it could not
> execute a single command to check.

A guard that admits a self-report unconditionally is not weaker than no guard;
it is worse, because the terminal state reads as a verdict.

## The two ways to close it, and why only one is right

**Making the sandbox work** is not the fix by itself — but it IS available, and
the first draft of this document was wrong to call it a host-level condition.

_Corrected 2026-08-16, by probe rather than by inference._ The sandbox was run
directly on this host under the worker's EXACT compiled settings
(`enabled`, `failIfUnavailable`, `autoAllowBashIfSandboxed: false`, no allowed
domains, no unix sockets, no local binding, `allowWrite` scoped to the working
directory) and `echo SANDBOX_OK` executed cleanly. It also succeeded with an
isolated `HOME`, with `XDG_RUNTIME_DIR` unset, and from a `setsid`-detached
process with stdio ignored — the daemon's own spawn shape. Eight variants, all
`OK`.

So `Failed to create bridge sockets after 5 attempts` is **not** WSL2 refusing
the sandbox, and not the compiled policy. It is specific to how crabgic spawns
its workers, which makes it crabgic's defect to fix rather than an environment
limitation to design around. What has not yet been isolated is which remaining
difference causes it — the leading candidate is bridge contention inside a
long-lived daemon that has already spawned several worker sandboxes ("after 5
attempts. Restart to retry." reads like collision, not absence).

What stays true is that disabling the sandbox to route around it is a known
security regression on this engine — a
sandboxed session auto-allows `Bash` (`autoAllowBashIfSandboxed`), which voids
the envelope's command allowlist entirely. Trading the allowlist for the ability
to run tests would be paying for verification with the very authority bound the
verification exists to protect.

**Refusing to publish unverified work** is the fix. A run whose acceptance
criteria were never evaluated must not reach `published_local`; it should settle
somewhere that says so. That turns a host limitation into a stated refusal
instead of a silent pass, and it holds on every host, including the ones where
the sandbox does work and a worker simply never ran the tests.

The refusal has to name what was not verified — and the run has the material to
say it precisely: the acceptance criteria are sealed at approval, the worker's
attempted commands are on the transcript, and the executed ones are not.

## Status

**Recorded, not fixed.** The change belongs to the gate tranche
`docs/deploy-posture.md` marks as an owner scope decision, and it converts today's
successful run into a refused one — which is correct, and is a decision about
what the product promises rather than a maintenance task.

---

## Resolved 2026-08-16 — the cause was a 108-byte limit, and the fix changed the outcome

**Root cause, isolated by probe with both controls.** `sun_path` in
`sockaddr_un` is 108 bytes on Linux; the sandbox creates its bridge sockets
under `TMPDIR`; the provisioned `TMPDIR` was **101 characters**
(`<cache>/<projectHash>/worktrees/workers/<work-unit-uuid>/tmp`), leaving seven
for a socket name. Same strict worker env with a SHORT `TMPDIR` runs `echo`
fine; with a long one it fails. Nothing about WSL2, the sandbox policy, the
isolated `HOME`, or detachment was implicated — each was tested and cleared.

`provisionWorkerDirs` now puts `TMP` under the system temp root, keyed by a
digest of base dir + worker id, so isolation and `0700` are preserved and only
the length changes.

**What changed in the next run (`bc167a3a`), measured:**

|                            | before (`04a0bf70`) | after (`bc167a3a`)                     |
| -------------------------- | ------------------- | -------------------------------------- |
| bridge-socket errors       | 12                  | **0**                                  |
| `Bash` calls that executed | 0                   | **29**                                 |
| tests written              | none                | `admissibility.test.ts`, +23 lines     |
| self-reported summary      | `"test"`            | a real account of all three advisories |

The worker ran `npm run build` and reported it clean. It wrote a test. And it
reported, unprompted, what it could NOT establish:

> `npm run test` could not be verified: every invocation … fails immediately
> with `EBUSY: resource busy or locked, rmdir .../coverage` before any test
> executes — a stale coverage directory.

That is the behaviour the whole design wants: a worker that runs its granted
commands and distinguishes what it checked from what it could not.

## The finding this document exists for is UNCHANGED

`bc167a3a` reached `published_local` anyway — with its own author stating in the
result record that the test suite never ran. So the system still publishes on an
unverified claim; it now publishes on an unverified claim that _says so_, which
is strictly better evidence and exactly the same guarantee.

Two follow-ons, both open:

- **The publish refusal** (this document's original recommendation) is still the
  fix, and it is now clearly worth building: the material to refuse on is sitting
  in the worker's own diagnostics.
- **`EBUSY … rmdir coverage`** is a new defect of its own — the attempt worktree
  inherits a `coverage/` directory vitest cannot clear, so `npm run test` cannot
  run in a worktree at all. Until that is fixed, no gate can verify anything even
  with the sandbox working.

### The `EBUSY` follow-on, probed: not what it looked like

Re-run by hand in the very worktree that reported it, `vitest` executes fine —
no `EBUSY`, tests run, coverage is measured. So the failure the worker met was
**transient**, most likely its own repeated invocations colliding on the
`coverage/` directory rather than a worktree that cannot run tests.

What the probe DID establish is a harder problem, and it is a design one rather
than a bug:

```
ERROR: Coverage for lines (0.48%) does not meet global threshold (80%)
```

`npm run test` is one of only four grantable command prefixes, and in this
repository it means **the whole suite with a global 80% coverage gate** — 7500
tests, several minutes, and a threshold that a filtered run can never satisfy. A
worker asked to verify a two-file change has no way to use it:

- run it filtered, and the coverage gate fails on the files it did not touch;
- run it whole, and it spends minutes of a bounded turn budget on a suite that
  is almost entirely unrelated to its change set.

So even with the sandbox now working, the granted verification command is not
usable **as configured** by a worker verifying a small change. That is the next
thing standing between "a worker can run commands" and "a gate can verify work",
and it is a decision about what commands an envelope should grant — a scoped
test invocation, or a per-change coverage bound — rather than a defect to patch.
