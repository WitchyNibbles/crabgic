---
name: evidence
description: Query recorded evidence for a change set. Thin wrapper over `engineering-orchestrator evidence`.
disable-model-invocation: false
---

# /eo:evidence

Lists the evidence records journaled for a change set.

Thin wrapper over `engineering-orchestrator evidence <change-set-id> --json`. Degrades
gracefully to an empty-but-valid report when nothing has been recorded yet — this
skill never fabricates evidence, and never queries anything beyond the journal (04)
via the CLI's own `queryEvidence`.

## Usage

```
/eo:evidence <change-set-id>
```
