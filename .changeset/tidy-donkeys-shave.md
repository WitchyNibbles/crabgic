---
"crabgic": minor
---

Give the manager session an operating protocol, and enforce the autonomous half of it.

Installed projects previously received a managed `CLAUDE.md` block that listed the plugin's
capabilities and said nothing about how to operate. With no instruction to the contrary a Claude
Code session uses its conversational default and checks in after every step — the opposite of a
harness whose own design names seven, and only seven, conditions that may halt a run.

- **New: the manager operating protocol.** Autonomy by default, roadmap/11's seven stop conditions
  as the only legitimate halts, the approval gates, and `AskUserQuestion` as the way to put a
  decision to the owner — never a plain-text list of numbered options. Written once in
  `manager-protocol.ts`, rendered into the managed `CLAUDE.md` block and into a new
  `/eo:protocol` skill that carries the long-form rationale.
- **New: the Stop autonomy gate.** A deliberately blocking `Stop` hook that refuses to end a turn
  while a run is in flight, so the autonomy clause is enforced rather than merely requested. It
  allows the stop at `awaiting_approval` (a human gate is legitimately open) and at every terminal
  state, cannot loop (`stop_hook_active`), and fails open on every error path — no supervisor, no
  runs, a timeout or a bad response all end the turn normally.
- **Fixed: the protocol reached repos with an `AGENTS.md`.** The `@AGENTS.md` bridge collapsed the
  entire managed block to that one import line, so those projects received no Crabgic instructions
  at all. The bridge is now additive.
- **New: `CRABGIC_NO_SPAWN=1`.** Makes any CLI command observe an already-running supervisor
  instead of starting one on demand — what lets a hook ask "is a run in flight?" without booting a
  daemon as a side effect of a session ending.

Engine facts behind both features are recorded in `docs/engine-baseline.md` §18 (the question
tool) and §19 (the `Stop` hook control contract), each with a re-runnable spike.
