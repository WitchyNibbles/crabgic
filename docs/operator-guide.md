# Operator guide

**Status:** Phase 23 (release hardening) work item 9. Every command below is cited from the
real, shipped CLI surface (`packages/cli/src/commands/`, `packages/cli/src/argv/types.ts`) —
not aspirational syntax. Where a command still returns the typed `NOT_IMPLEMENTED` shape at
this repository's current build (no backend wired for this pass), that is stated explicitly.

## 1. Installing

```
crabgic install [--dry-run] [--json]
```

Scaffolds the plugin/managed configuration into the current project: the `CLAUDE.md` managed
block, `.claude/settings.json` add-only keys (attribution suppression,
`enabledPlugins`, `statusLine`), `.claude/agents/eo-*.md`,
`.claude/crabgic-statusline.mjs`, and a project-scope `.mcp.json` entry for the
gateway MCP server. The merge is **add-only**: every user-added key already present is
byte-preserved, and a security-relevant key already present is never loosened
(`docs/evidence/phase-10/README.md`, property-tested over a fuzzed fixture corpus). Run
`--dry-run --json` first to inspect what would change before committing to it.

The status line renders the model and its reasoning effort, the current branch and
dirty flag, session context-window usage, and the 5-hour and weekly subscription usage
windows. It is registered as
`node "${CLAUDE_PROJECT_DIR:-.}/.claude/crabgic-statusline.mjs"` rather than an absolute
path, so a committed `.claude/settings.json` stays portable across machines. Two engine
constraints force this shape and are recorded in `docs/engine-baseline.md` §17: the
plugin manifest has no `statusLine` key, and a `settings.json` command referencing
`${CLAUDE_PLUGIN_ROOT}` is rejected outright. The two usage segments render only for
Claude.ai subscription auth, and only after the session's first API response populates
the rate-limit headers. `CRABGIC_STATUSLINE_ASCII=1` selects plain glyphs; `NO_COLOR`
is honoured.

Distribution is via a SHA-pinned marketplace listing or a digest-pinned vendored plugin
directory; the plugin bundle itself passes the capability-quarantine pipeline (12) before
being marketplace-listed (see `docs/security-posture.md`, "4. Installer" and "7. Capability
quarantine").

## 2. Running a change set

```
crabgic run [--json]
```

`run` drives the full intake → contract → approval sequence before a `ChangeSet` is handed to
the scheduler:

1. It resolves a drafted intake request (the manager-session-authored request content — this
   command does not draft it itself).
2. It builds the `IntentContract`, DAG, and `AuthorizationEnvelope`, creating a `ChangeSet` (or
   reusing an existing one — re-running `run` against an unchanged repo never creates a second
   `ChangeSet`, `docs/evidence/phase-11/README.md` exit criterion 7).
3. If the `ChangeSet` is not already resolved as a conflict, it renders a **terminal approval
   prompt** naming the exact envelope digest about to be approved and waits for an explicit
   `yes`:

   ```
   About to approve the following authorization envelope digest:

     <sha256 digest>

   Type "yes" to approve, anything else to abort:
   ```

   Typing anything other than an exact (case-insensitive, trimmed) `yes` aborts — no token is
   minted, nothing is approved (`packages/cli/src/approval/prompt.ts`). This terminal prompt
   is the **only** place in the entire system a human-approval token is minted — no scripted,
   non-interactive, or model-driven path can reach it (`docs/security-posture.md`, "3. Envelope
   compiler").

4. On `yes`, a single-use, HMAC-signed token is minted and durably verified server-side against
   this exact `ChangeSet`'s own envelope digest (never a caller-supplied one — the confused-
   deputy fix recorded in `docs/security-posture.md`), and the `ChangeSet` transitions to
   `ready` for dispatch.

An unmapped requirement (a DAG node with no owning `WorkUnit`) blocks the `ready` transition
before the approval prompt is even reached — no token is spent on an incomplete DAG
(`docs/evidence/phase-11/README.md` exit criterion 4).

## 3. Checking status

```
crabgic status [run-id] [--watch] [--json]
```

- With a `run-id`: queries the supervisor's `run.status` operation over the UDS control plane
  and prints the run's current state (`changeSetId`, `runState`, `updatedAt`).
- `--watch`: streams subsequent status-change events until the process is interrupted
  (Ctrl+C) or the run reaches a terminal state.
- Without a `run-id` (listing every run): **`NOT_IMPLEMENTED`** at this repository's current
  build — the supervisor's router has no `registry.runs.list` operation wired yet
  (`packages/cli/src/commands/real-handlers.ts`'s own doc comment).

```
crabgic cancel <run-id|task-id>
```

Cancels a run (or, once 13's task-level semantics are wired, a single task within it) via the
supervisor's `run.cancel` operation.

## 4. Reviewing evidence

```
crabgic evidence <change-set-id>
```

Queries 04's journal directly and prints every `EvidenceRecord` recorded against the given
`ChangeSet` id — one line per record (`command`, exit status, exact object ID, capture
timestamp), or a plain "no evidence recorded yet" message if the `ChangeSet` has none yet.
`--json` returns the full structured report. This is the operator's real, retrievable path to
the rendered PR-title/PR-body/review-comment artifacts and every gate's `EvidenceRecord` — the
system never opens a pull request or pushes anywhere; the evidence bundle plus a local,
attribution-free branch is the entire hand-off (interface-ledger Gap 6; see
`docs/security-posture.md`, "8. Renderer").

## 5. Approving high-impact capability grants

```
crabgic trust review|approve|revoke
```

**`NOT_IMPLEMENTED`** at this repository's current build — 12's `trust review|approve|revoke`
backend exists in `packages/detect`, but the CLI-dispatch wiring into `packages/cli` is an
explicit, documented carry-forward from phase 11, left for whichever phase/reconcile pass owns
that wiring decision (`docs/evidence/phase-11/README.md`, "Carry-forwards from prior phases").
`capability.approve` itself only ever verifies a previously human-minted `trust approve`
token; it is never model-satisfiable, mirroring `contract.approve`'s own treatment.

## 6. Managing external connections

```
crabgic connection add jira|grafana
crabgic connection list
crabgic connection doctor <connection-id>
crabgic connection capabilities <connection-id>
```

**`NOT_IMPLEMENTED`** at this repository's current build — these commands are declared on the
argv surface (`packages/cli/src/argv/types.ts`) but have no wired backend in this pass. Once
wired, `connection doctor` runs the gateway's reachability probe (custom-CA validation
included) against a stored connection end-to-end without performing a mutating call — the
same probe 16's connection-doctor implements and 18/19/20 extend
(`docs/security-posture.md`, "6. Connectors").

## 7. Reviewing and approving learning proposals

```
crabgic learn list
crabgic learn approve <proposal-id>
crabgic learn reject <proposal-id>
crabgic learn rollback <proposal-id>
```

- `learn list`: shows every learning proposal and its pipeline stage.
- `learn approve <id>`: records one verified approval per invocation, through the identical
  terminal-prompt/HMAC-token mechanism `run`'s approval flow uses, under a distinct
  `"learning_review"` subject kind bound to this exact proposal's content digest. **Promotion
  requires two separate, successful `learn approve` invocations against the same proposal** —
  the same operator running it twice at two separate terminal prompts satisfies this (this
  repository has no multi-tenant reviewer-identity system; see `docs/security-posture.md`,
  "9. Learning store" for the precise, disclosed scope of this guarantee). No model or MCP
  tool can ever reach this path — there is no `learning.*` MCP tool family anywhere in this
  system, permanently enforced by a CI-run grep check.
- `learn reject <id>`: rejects a proposal; changes nothing else about its recorded evidence.
- `learn rollback <id>`: reverts a previously-promoted proposal's effect, producing an inverse
  `ChangeSet` that clears the same gates (14) as any other change before publish.

## 8. Upgrading, uninstalling

See `docs/upgrade-guide.md` for `upgrade`/`uninstall` in full — drift detection, rollback, and
the add-only merge discipline that makes both operations safe to run against a project with
independent user edits.

## 9. Doctor

```
crabgic doctor [--repair-plan] [--json]
```

Runs the full seeded fault-check suite against the current host/project (hermeticity,
version-gate, installer drift, plugin trust-pin, capability-manifest freshness, and more).
`--repair-plan` additionally prints a **non-destructive** repair plan (never `delete`/`force`/
`rm -rf` — regex-checked to exclude those verbs, `docs/evidence/phase-10/README.md` exit
criterion 5) — the plan is only proposed, never auto-executed.

## 10. Reading the release-gate report

The release-gate report — written to e2e/release-gate-report.json, which is **generated, not
committed**, so download it from the `release-gate-report` artifact of a `release-e2e` run, defined
in `.github/workflows/release-e2e.yml` — is the checklist-item → `EvidenceRecord` audit trail phase
23 itself produces. The item list it scores is committed, at `e2e/report/src/checklist.ts`. It is
not an operator-facing CLI command, but operators verifying a release candidate's readiness should
read it directly. Each
item names its own `id`, a plain-English `description`, whether it's `required`, its current
`verdict` (`PASS` / `EVIDENCE-PENDING` / a failing verdict — **never PASS-by-default on
missing evidence**, per the generator's own design), the `linkedEvidence` array of matching
`EvidenceRecord`s, and — when pending or failing — a `reason` string. See
`docs/compatibility-matrix.md`'s "What is EVIDENCE-PENDING vs. verified" section for this
repository's current snapshot of that report.

## 11. The gateway MCP server (advanced / not a direct operator action)

```
crabgic gateway mcp
```

Boots the gateway's MCP server over stdio — a long-running process with no user-facing flags,
started directly by the CLI's entry point (`bin.ts`), never dispatched through the ordinary
command/response model. This is the process a Claude Code session connects to as the sole
MCP server this system registers; operators do not invoke it directly in normal use — the
plugin/installer wires it into the project's `.mcp.json` automatically.
