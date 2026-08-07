---
"crabgic": patch
---

**The bundled `eo-explore` subagent had no turn bound, and a malformed one would have been silently
dropped.** A subagent's turns never reach the parent session's turn counter, so nothing downstream
bounded them: one "count the files in this directory" request served roughly fifty nested round trips
before returning. The installed subagent's frontmatter now declares `maxTurns: 30`, below the engine's
built-in 200-turn default, and that file is the one `crabgic install` writes into a project.

The manifest validator now also refuses an unreadable `maxTurns` — a non-integer, a zero or negative
value, or a quoted one — instead of letting the loader drop it back to the built-in default. That
matters more than the bound itself: a frontmatter value the engine cannot parse fails open, so a
subagent that looks bounded on disk would have run unbounded, and no channel warned about it.
