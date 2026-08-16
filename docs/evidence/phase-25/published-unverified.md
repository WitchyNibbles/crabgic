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
