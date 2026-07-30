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
`{Bash, Edit, Write}`, the set the profile grants by rule, where the envelope
policy's verdict mirrors the engine's own rule evaluation. Still deny-only —
the allow path records the decision (journal + audit) and returns no opinion,
so the bridge can narrow but never widen what the profile grants.

Deliberately NOT extended to `Read`/`Glob`/`Grep`: the envelope policy
default-denies any unlisted tool while the engine grants read-only tools
without a rule, so a deny-only opinion there would black-hole every read a
worker makes.

Verified live end-to-end: a real adapter-spawned worker's `git status` call
produced a journaled allow decision via the bridge, put real records in the
PostToolUse audit's scope for the first time, and did not spuriously abort.
`adjudication-bridge.live.test.ts` now ASSERTS that record exists — the
original version only recorded whether `canUseTool` fired, which is how this
went unnoticed.
