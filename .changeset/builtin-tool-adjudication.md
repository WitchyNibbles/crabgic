---
"crabgic": patch
---

Adjudicate `Bash`, `Edit` and `Write` calls, which nothing was.

Adversarial review suspected it, and a live probe confirmed it: a matched
RULE-SHAPED allow entry (`Bash(git status:*)` — the exact shape the compiled
profile grants the mutation-capable built-ins) shadows `canUseTool` exactly
like a bare name does (`docs/engine-baseline.md` §4.7, measured at engine
2.1.218 by `builtin-allow-rule-shadowing.live.test.ts`). Together with §4.5
that meant _no_ production tool grant reached the journal-first adjudication
callback: every `Bash`, `Edit` and `Write` a worker made executed with no
adjudication record and sat outside the PostToolUse audit's scope — the same
hole the gateway family had, on the tools that mutate things.

The gateway's `PreToolUse` bridge is now the tool-adjudication bridge
(`tool-adjudication-hook.ts`): it covers the gateway wire prefix plus exactly
`{Bash, Edit, Write}`, the set the profile grants by rule. Gateway denies are
enforced as before. Built-in verdicts are **recorded, not enforced** — a
second live measurement (§4.8, also review-triggered) showed the envelope
policy is STRICTER than the engine inside a matched rule (the engine executes
`git status 2>&1`; the policy's metacharacter fail-closed denies it), so
acting on the verdict would refuse everyday commands like `npm run test 2>&1`
that the engine grants. The journal entry is the alarm; the engine's own rule
evaluation plus the OS sandbox remain the boundary. Two exceptions enforce
even for built-ins: adjudication unavailable denies (no unrecorded mutation
call proceeds), and an explicit `interrupt` halt is honored.

Deliberately NOT extended to `Read`/`Glob`/`Grep`: the envelope policy
default-denies unlisted tools the engine grants without rules — covering them
would journal meaningless deny verdicts and black-hole reads when the bus is
down.

Verified live end-to-end for both `Bash` and `Write`: real adapter-spawned
workers produced journaled decisions via the bridge, put real records in the
PostToolUse audit's scope for the first time (Pre→Post `tool_input` measured
stable for both), and did not spuriously abort.
`adjudication-bridge.live.test.ts` now ASSERTS those records exist — the
original version only recorded whether `canUseTool` fired, which is how this
went unnoticed.
