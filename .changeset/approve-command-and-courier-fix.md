---
"crabgic": minor
---

Make approval completable — and stop couriering the token.

**`crabgic approve <envelope-digest>` exists now.** The `/eo:approve` skill has
delegated to "the orchestrator CLI's own terminal-prompt approval flow" since
1.0.0, and no such command was in the argv surface — the skill pointed at a
door with no building behind it. The new command resolves the digest to the one
ChangeSet awaiting approval whose OWN stored envelope carries it (never the
caller's pairing), renders the same prompt `run` uses, and completes
verification in the same process. It refuses a piped or scripted stdin
outright: the prompt is the human-only gate, and a shell without an interactive
terminal — a model-driven one, say — cannot satisfy it.

**Approval now completes in-process, in both commands.** `run --json` used to
print the minted token to stdout for `contract.approve` to consume in another
process — in a manager session that makes the model the courier for a
human-approval token, the exact exposure ledger Gap 18's audit recorded. And in
human mode the token went nowhere at all, so a confirmed prompt still left the
ChangeSet un-approvable. Confirmation now mints, verifies against the
ChangeSet's own stored digest, and advances `awaiting_approval → ready` before
the command returns; the spent token is never rendered anywhere, and requirement
coverage is resolved server-side from the ChangeSet's own IntentContract. The
MCP `contract.approve` tool is unchanged.

**The approval prompt settles on EOF instead of hanging forever.**
`crabgic run < intake.json` drains stdin to parse the request, so the prompt
was listening on a stream that had already said everything it ever would — the
process hung with the prompt on screen. End-of-input now terminates the final
line: bare EOF declines (exactly what the function's own contract always
claimed), and the decline message names the `crabgic approve` command that can
finish the job later. A stream error declines too, and never crashes.

**A daemon that dies during startup now tells you why.** The spawned
supervisor's stderr went to `stdio: "ignore"`, so a fatal at boot surfaced as a
generic "could not reach the supervisor control socket" after the whole retry
budget. The spawner now points stderr at `supervisord.stderr.log` under the
project's state root (truncated per spawn), and the exhaustion error carries
its tail.
