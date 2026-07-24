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

Even once explicitly invoked, this skill does not mint an approval token itself. It
renders the exact digest under review and delegates to the orchestrator CLI's own
terminal-prompt approval flow (`packages/cli`'s `runApprovalFlow`, roadmap/09), which
is the ONLY code path that ever calls the token minter. The MCP `contract.approve`
tool then verifies that supervisor-issued token — it never mints one itself either.

## Usage

```
/eo:approve <envelope-hash|manifest-digest>
```

A human must read the rendered digest and confirm interactively; there is no
`--yes`/non-interactive flag anywhere in this path.
