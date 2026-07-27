<div align="center">

<img src="https://raw.githubusercontent.com/WitchyNibbles/crabgic/main/assets/brand/crabgic-logo-512.png" alt="Crabgic" width="260">

### Claude Code, but it ships the whole change set 🦀✨

</div>

Crabgic turns Claude into an **autonomous engineering orchestrator**. It plans the work,
hands each piece to a sandboxed worker in its own git worktree, and refuses to propose
anything that has not survived quality, security, and performance gates.

You show up for two decisions. It does the rest. 🎩

## 🚀 Install

```bash
npm install -g crabgic

cd your-project
crabgic install     # sets up the plugin + managed config (try --dry-run first 👀)
crabgic doctor      # 🩺 check the host is actually healthy
```

Then hand it work — `run` reads an intake request as JSON on stdin:

```bash
crabgic run < intake.json
crabgic status <run-id> --watch     # 👀 live
crabgic evidence <change-set-id>    # 📜 what it did, and why you should believe it
```

`crabgic install` is add-only and byte-preserving. It never runs `git add` or `git commit`
for you.

## 🎩 Inside Claude Code

Installing registers a plugin, so these are just there:

| Skill | What it does |
| --- | --- |
| `/eo:run` | 🚀 Start a run against the current change intent |
| `/eo:status` | 👀 Show or live-watch a run |
| `/eo:evidence` | 📜 Pull recorded evidence for a change set |
| `/eo:connections` | 🔌 List and inspect Jira / Grafana connections |
| `/eo:approve` | 🔐 Approve a pending envelope — **never** model-invocable |

Plus two subagents (`eo-explore`, `eo-reviewer`) and two always-advisory hooks.

## 🛠️ Commands

| Command | What it's for |
| --- | --- |
| `crabgic install [--dry-run] [--json]` | 📦 Install the plugin / managed config |
| `crabgic doctor [--repair-plan] [--json]` | 🩺 Validate the host end-to-end |
| `crabgic run [--json]` | 🚀 Dispatch a new run |
| `crabgic status [run-id] [--watch] [--json]` | 👀 Show or stream a run's status |
| `crabgic resume <run-id>` | ▶️ Resume a parked or interrupted run |
| `crabgic cancel <run-id\|task-id>` | 🛑 Cancel a run or a task |
| `crabgic evidence <change-set-id>` | 📜 Show every `EvidenceRecord` for a change set |
| `crabgic connection add\|list\|doctor` | 🔌 Manage connector connections |
| `crabgic trust review\|approve\|revoke` | 🔐 Review high-impact capability grants |
| `crabgic learn list\|approve\|reject\|rollback` | 🧠 Manage learning proposals |
| `crabgic upgrade [--dry-run]` | ⬆️ Upgrade the install |
| `crabgic uninstall [--keep-state]` | 👋 Remove it |
| `crabgic gateway mcp` | 🛡️ Boot the gateway MCP server over stdio |

The supervisor daemon starts on demand — nothing to babysit. 😌

## 🔐 Where you stay in the loop

Two blocking gates — plus one more if you turn on learning. All live in your terminal, and
none can be reached by a model, a script, or a CI job.

- **🤝 Envelope approval** — before work runs, the terminal prints the sha256 digest of the
  authorization envelope and waits for you to type `yes`. That prompt is the only place an
  approval token is ever minted; the token is single-use, HMAC-signed, and verified in a
  different process against that change set's own digest.
- **🕵️ Capability quarantine** — `crabgic trust review` shows grants that crossed the
  high-impact line. Approving and revoking are yours.
- **🧠 Learning promotion** — `crabgic learn approve`, twice, on separate invocations.

## 🔌 Connectors

Jira (Cloud + Data Center) and Grafana (Cloud / OSS / Enterprise), all behind a policy
gateway with exactly-once mutation and read-back verification. Workers never hold
credentials.

Secrets go in **by reference, never by value** — `env:NAME`, `op://…`, `vault://…`,
`file:///abs/path`, or `ref:<opaque-id>`. Paste a real token and it's rejected on sight. 🚫🔑

## 📦 Requirements

- **Node.js ≥ 24**
- **Linux x86-64 / ARM64**, including WSL2
- A **Claude subscription** — workers run on yours, via the Agent SDK
- `claude` CLI in the accepted range **2.1.207 – 2.1.220**

## 📚 Docs

- [Operator guide](https://github.com/WitchyNibbles/crabgic/blob/main/docs/operator-guide.md) — the end-to-end flow, command by command
- [Upgrade guide](https://github.com/WitchyNibbles/crabgic/blob/main/docs/upgrade-guide.md)
- [Compatibility matrix](https://github.com/WitchyNibbles/crabgic/blob/main/docs/compatibility-matrix.md) — every supported version, with evidence
- [Security posture](https://github.com/WitchyNibbles/crabgic/blob/main/docs/security-posture.md) · [Threat model](https://github.com/WitchyNibbles/crabgic/blob/main/docs/threat-model.md)
- [Full README](https://github.com/WitchyNibbles/crabgic#readme) — including known gaps

## 📄 License

[Apache-2.0](https://github.com/WitchyNibbles/crabgic/blob/main/LICENSE). Go build
something. 🦀🎩✨
