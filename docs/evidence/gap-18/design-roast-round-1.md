# Gap 18 — `EnvelopePolicy` design roast, round 1 (2026-07-28)

Two independent adversarial reviewers, neither of which authored the design, each given a
distinct lens (containment escapes; operability and correctness-in-practice). Per ledger
Gap 19 the round **extends** the loop: it produced findings that are novel and falsifiable,
at every severity, so a round 2 is owed after the design revision below.

Every finding recorded here was **re-verified against the source by hand** before being
accepted. Two reviewer claims were checked and are recorded as cleared rather than dropped
silently. This is not a transcript — it is the verified subset.

## The refutation that matters

> The policy scopes *what the envelope declares*; the compiled profile grants *the whole
> worktree plus arbitrary child-process execution*, while the two dimensions the design
> leaned on — high-impact flags and prohibited actions — are both authored by the model and
> enforced by nobody.

That is correct, and it is not a detail. It means the design as balloted **cannot deliver
the property it was ruled on**, so the ruling's implementation must change (the ruling's
*intent* does not).

## Verified findings

| # | Sev | Finding | Verified by |
|---|---|---|---|
| F1 | **CRITICAL** | An allow-listed command's **child processes** write anywhere the sandbox permits, and `filesystem.allowWrite` is the **whole worktree**. Owned-path scoping is enforced by the permission layer, which sees tool calls — not the syscalls of a process it spawned. A worker writes a test file inside its owned path, then `npm run test` executes it. | `sandbox-profile.ts:95-127`'s own doc comment ("`allowWrite` IS STILL THE WHOLE WORKTREE"); `sandbox-containment-determination.json` — its `arms[].attempts[]` contain only top-level `Write`/redirect probes, **no child-process arm exists** |
| F2 | **CRITICAL** | "Zero high-impact flags ⇒ trivially contained" is false. The flags are assigned by static per-kind tables, not by risk: Grafana omits `dashboard`/`folder`/`annotation` entirely; a Jira single-issue update carries no flag unless it touches assignee/reporter. A policy auto-granting *nothing* still permits rewriting a production dashboard, or 900 sequential single-issue updates. | `connectors-grafana/src/resource-kinds.ts`, `connectors-jira/src/high-impact-capabilities.ts` |
| F3 | **CRITICAL** | `RemoteMutationPlan.requiredCapabilityFlags` has producers and **zero consumers** — it is never compared against the envelope's granted flags at apply time. Containment would gate a field with no downstream enforcement point. | grep: producers in `issue-plans.ts`/`mutation-plan-builder.ts`, no reader in `gateway`/`supervisor`/`gates` |
| F4 | **HIGH** | `network.allowAllUnixSockets: true` is **unconditional** — no envelope or policy dimension can turn it off. So `allowedNetworkDestinations: []` does not mean "no network": a reachable `docker.sock` is host-root write, and `SSH_AUTH_SOCK` is not covered by the `~/.ssh` `denyRead`. | `sandbox-profile.ts:141` |
| F5 | **HIGH** | `prohibitedActions` widens authority when dropped, because **nothing enforces it** — its only reader was the human being removed. The model authoring the intake controls the field. "A prohibition can only narrow" holds only where prohibitions are enforced. | grep: no consumer outside the envelope builder and the canonical hash |
| F6 | **HIGH** | `envelope.commands` is inert beyond four literals. `emitPermissionProfile` uses it **only** to gate which of `MANDATORY_BASH_ALLOWLIST`'s four entries are emitted; every other string is silently discarded. A policy governing `allowedCommands` would halt runs over strings that leave the compiled profile byte-identical. | `permission-profile.ts:118-121` |
| F7 | **HIGH** | First run on a Node repo cannot proceed at any policy setting: no `npm ci`/`node_modules` provisioning exists in `git-engine`, the driver or the daemon, and `npm ci` is neither a grantable literal nor reachable with a default-empty network. | `worktree-lifecycle.ts:103`; grep for install steps |
| F8 | **HIGH** | The halt has no recovery path. `blocked` is absorbing; `resume` does not check run state and reports success while the re-drive dies in a swallowed `IllegalTransitionError`; `amendEnvelope` demotes a `ready` ChangeSet to `cancelled`; a same-`requestKey` re-intake returns `conflict` before approval. Only escape is a hand-edited policy plus a brand-new `requestKey`. | `run-lifecycle.ts:59`, `build-router.ts:114`, `run-dispatcher.ts:292`, `amendment.ts:112,154` |
| F9 | **HIGH** | A vacuous policy is indistinguishable from a working one. All four proposed doctor checks (exists, parses, `0600`, untracked) **pass** on all-empty lists, while every run halts. | the proposed check set itself |
| F10 | **HIGH** | Schema drift is asymmetric and undeclared. A 12th high-impact flag fails **closed**; a 9th top-level authority field added `.optional()` fails **open** (old policies silently authorize an axis their author never saw). A `schemaVersion` bump instead hard-breaks every on-disk policy, and `upgrade` is forbidden from re-deriving one. | `shared/schema-version.ts`, `.strict()` on every contract |
| F11 | **MEDIUM** | Exactness stops at containment. `allowedCommands: ["npm run test"]` compiles to `Bash(npm run test:*)`, a prefix rule matching `npm run test --config <worker-authored file>`. | `permission-profile.ts` `MANDATORY_BASH_ALLOWLIST` |
| F12 | **MEDIUM** | Segment-aware prefixing is string-level; the grant is a filesystem glob. A symlinked owned path defeats it, and the anchor form's matching semantics are already recorded as unprobed. Not fixable inside the containment rule — only by resolving paths at dispatch. | `owned-path.ts`'s own ENGINE-FACT-DRIFT note; no symlink arm in the live suite |
| F13 | **MEDIUM** | Containment ignores `canonicalHash` and does not bind envelope→ChangeSet; `contract-approve-handler.ts:100` trusts the **stored** hash rather than recomputing it. | `contract-approve-handler.ts:100` |
| F14 | **LOW** | `allowedDependencies`/`allowedTemporaryServices` are inert — no consumer anywhere. Listing them in a policy creates false coverage. | grep |

## Dimensions attacked and **not** broken

Recorded so a later reader does not re-litigate them:

- **Segment-aware path prefixing at the string level is sound.** `./src`, `src/.`, `src//x`,
  `src/`, trailing whitespace, `srcfoo`, case variants and traversal forms were all tried;
  `validateOwnedPath` rejects absolute, `~`, `..` and every glob metacharacter, and the
  residual forms fail **closed**. One requirement falls out: compare `validateOwnedPath()`'s
  *return value* on both sides, or halts become inconsistent (still closed, but confusing).
- **`allowedNetworkDestinations` as an exact set over `validateNetworkDestination` output is
  sound** for what it covers. Its weakness is F4 — it is not the whole network surface.
- **`allowedCredentialReferences` as an exact set is sound.** No normalization asymmetry.
- **Journaling the per-dispatch policy digest needs no 14th `JournalEntryType`.**
  `adjudication_decision`'s payload is free-text and is already reused this way by
  `stop-conditions.ts` and `amendment.ts`. Cost: "ran under standing policy" becomes
  string-matchable rather than structurally queryable.

## Design revision this forces

**The `EnvelopePolicy` stops being only a gate and becomes a compiler input.**

`sandbox-profile.ts` declines to narrow `allowWrite` for a stated and correct reason: build
output directories are "project-specific and unknowable **here**" — the compiler's only
inputs are one envelope's four fields. That is true of the compiler and false of the system.
A human-authored, install-time policy is *exactly* the artifact that can declare them. So:

1. **`allowedWriteScratchPaths`** — narrows `filesystem.allowWrite` from the whole worktree
   to owned paths plus declared scratch. Answers F1 by shrinking the coarse boundary to
   something the policy can express, instead of asserting a fine boundary that child
   processes bypass.
2. **`allowUnixSockets: false` by default** — makes F4's grant a declared one.
3. **Remote resource authorizations escalate by default.** Not "no flags"; *any*
   `remoteResourceAuthorizations` entry is out-of-policy unless the policy names an allowed
   reference. F2 shows the flag taxonomy cannot carry this weight, and F3 shows it is not
   enforced downstream anyway.
4. **Containment must ignore no dimension silently.** Unknown or absent policy field ⇒
   **deny**, stated explicitly (F10). Inert envelope fields (F5, F6, F14) are recorded as
   inert in the schema doc rather than presented as controls.
5. **Refuse at dispatch; do not create a run to block it.** Answers F8: with no run created,
   the ChangeSet stays `ready`, and fixing the policy and re-dispatching just works. The
   per-attempt check stays as defence in depth, where the run is already `running` and
   `blocked` is a legal edge.
6. **Resolve owned paths at dispatch and refuse symlinks** (F12); **recompute the canonical
   hash and bind envelope→ChangeSet** (F13).

## Owed, and not resolved here

F7 (no dependency provisioning in a fresh worktree) is a real blocker for the first live
end-to-end run and belongs to the git-engine/driver, not to this design. F3 and F6 are
pre-existing enforcement gaps that predate Gap 18; they are recorded here because standing
approval is what makes them load-bearing, but fixing them is separate work.
