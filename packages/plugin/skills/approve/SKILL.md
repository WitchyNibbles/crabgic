---
name: approve
description: Human-confirmed approval of a pending authorization envelope or capability manifest digest. Never model-invocable — requires an explicit, interactive human confirmation before any token is minted.
disable-model-invocation: true
---

# /eo:approve

Approves a pending authorization envelope or capability-manifest digest.

**This skill is `disable-model-invocation: true` by design** — adaptation §5.5 is
explicit that "the model must not be able to satisfy its own approval gate." This
skill only ever runs when a human explicitly types `/eo:approve` themselves; it is
never reachable as a bare model-initiated tool call.

Even once explicitly invoked, this skill does not mint an approval token itself —
and neither can the session. Approval happens in the operator's OWN terminal:

- **Authorization envelope** (`awaiting_approval` ChangeSet): tell the human to run
  `crabgic approve <envelope-hash>` in their terminal. That command renders the
  digest, reads an interactive confirmation (`packages/cli`'s `runApprovalFlow`,
  roadmap/09 — the ONLY code path that ever calls the token minter), and completes
  verification in the same process; the token is spent before the command returns
  and is never printed anywhere. **Scope, stated plainly:** approval records the
  owner's consent to the PLAN (`awaiting_approval → ready`). It cannot grant
  authority beyond the standing policy — the daemon's dispatch gate is
  containment-only and reads no token, so an envelope outside the policy is
  refused again at dispatch. For an authority escalation, the human edits the
  standing policy file the refusal names, then re-runs `crabgic run`.
- **Capability manifest**: tell the human to run `crabgic trust review`, then
  `crabgic trust approve` — roadmap/12's quarantine flow.

The command refuses to prompt without an interactive terminal, so running it from
this session's own shell cannot approve anything — that refusal is correct, not an
error to work around. Render the exact digest under review for the human first, so
what they type is what they saw here.

## Usage

```
/eo:approve <envelope-hash|manifest-digest>
```

A human must read the rendered digest and confirm interactively; there is no
`--yes`/non-interactive flag anywhere in this path.
