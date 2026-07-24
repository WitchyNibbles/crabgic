---
name: connections
description: List and inspect configured connector connections (Jira, Grafana). Thin wrapper over `engineering-orchestrator connection list|doctor|capabilities`.
disable-model-invocation: false
---

# /eo:connections

Lists configured connector connections and their doctor/capability status.

Thin wrapper over `engineering-orchestrator connection list --json` (and, for a named
connection, `connection doctor <id>` / `connection capabilities <id>`). This skill
never adds or mutates a connection — `connection add` requires a secret _reference_
argument at the CLI's own parse boundary and is deliberately not exposed as a
model-invocable skill here.

## Usage

```
/eo:connections
/eo:connections <connection-id>
```
