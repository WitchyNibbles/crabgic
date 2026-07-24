---
name: run
description: Start a new Engineering Orchestrator run against the current change intent. Thin wrapper over the `engineering-orchestrator run` CLI/gateway op.
disable-model-invocation: false
---

# /eo:run

Starts a new orchestrator run for the current project.

This skill is a thin wrapper: it shells out to `engineering-orchestrator run --json`
(or calls the equivalent gateway MCP op, once 11/13 land the drafting flow) and
reports the resulting `runId` and initial state back to the session. It performs
no orchestration logic itself — the CLI/supervisor (05/09) own that.

## Usage

```
/eo:run
```

## Notes

- If the supervisor is not reachable, the wrapped CLI call surfaces
  `SupervisorUnavailableError`'s message verbatim — this skill never masks it.
- This skill never mints approval tokens and never bypasses the human-confirmed
  approval flow (`/eo:approve`) for anything the run later requires approval for.
