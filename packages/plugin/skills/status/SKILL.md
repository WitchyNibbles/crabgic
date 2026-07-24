---
name: status
description: Show the status of an Engineering Orchestrator run (or watch it live). Thin wrapper over `engineering-orchestrator status`.
disable-model-invocation: false
---

# /eo:status

Reports the state of a run.

Thin wrapper over `engineering-orchestrator status [run-id] [--watch] --json`. This
skill only renders the CLI's own output — it never re-derives run state itself, and
never advances/mutates run state (that's `/eo:run`, `/eo:approve`, or a direct
`engineering-orchestrator cancel`).

## Usage

```
/eo:status <run-id>
/eo:status <run-id> --watch
```
