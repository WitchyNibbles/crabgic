# Operator guide

**Status:** Phase 23 (release hardening) work item 9. Every command below is cited from the
real, shipped CLI surface (`packages/cli/src/commands/`, `packages/cli/src/argv/types.ts`) —
not aspirational syntax. Where a command still returns the typed `NOT_IMPLEMENTED` shape at
this repository's current build, that is stated explicitly, along with what specifically is
missing. Exactly one command is in that state today: `connection capabilities` (§6).

## 1. Installing

**Before installing anywhere that matters (2026-08-05):** deployment is not yet certified. See
`docs/deploy-posture.md` for the one blocking item and the honest residual list.

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

`run` drives the full intake → contract → approval → dispatch sequence:

1. It resolves a drafted intake request (the manager-session-authored request content — this
   command does not draft it itself; `/eo:run` is what drafts it from your conversation).
2. It builds the `IntentContract`, DAG, and `AuthorizationEnvelope`, creating a `ChangeSet` (or
   reusing an existing one — re-running `run` against an unchanged repo never creates a second
   `ChangeSet`, `docs/evidence/phase-11/README.md` exit criterion 7).
3. **The standing approval decides** (interface-ledger **Gap 18**, adaptation §5.5). The built
   envelope is tested for containment in the `EnvelopePolicy` `crabgic install` wrote — the one
   you read once, carefully, at install time. Three outcomes:

   - **Contained** → the `ChangeSet` goes to `ready` with **no prompt and no token**, and the
     authorizing policy digest is journaled so "what was the human standing behind this" stays
     answerable afterwards.
   - **Not contained, or no readable policy** → nothing is dispatched. The refusal names _every_
     dimension that escapes at once, and the standing policy file to add it to, because that
     edit is the only remedy: the dispatch gate is containment-only and reads no token, so
     `crabgic approve` cannot grant the missing authority (§2.1). Widen the policy, then run
     `crabgic run` again.
   - **A requirement no `WorkUnit` owns** → a planning gap, not an authority question. No
     approval route fixes it; fix the DAG and run intake again
     (`docs/evidence/phase-11/README.md` exit criterion 4).

4. An approved `ChangeSet` is **dispatched**: the daemon mints the run id, re-checks containment
   against the policy _it_ can see, and starts driving the DAG. `run` reports the run id.

   If the supervisor cannot be reached, the approval is not lost — it is durable, and the
   `ChangeSet` stays `ready`. Retry the start; do not re-author the request.

### 2.1 Recording consent to a plan (and why it is not the out-of-policy remedy)

```
crabgic approve <envelope-digest>
```

The only place a human-approval token is ever minted — but read what it does and does not
do. It gates exactly one thing: the `awaiting_approval → ready` transition, i.e. a human's
consent to the **plan** (a material amendment, or an intake whose prompt declined). It
grants **no authority**. The daemon's dispatch gate re-checks containment against the policy
and reads no token, so an envelope outside the standing policy is refused again at dispatch
no matter how many approvals are minted. **The remedy for out-of-policy work is editing the
standing policy the refusal names, then re-running `crabgic run`** — not this command.

When it is the right tool, it renders the **authority itself** — change set, owned paths,
commands, network destinations, credential references, prohibited actions — and then the
digest, because a bare hash is not something a human can evaluate. It waits for an exact
(case-insensitive, trimmed) `yes`; anything else aborts with nothing minted.

The token is single-use, HMAC-signed, verified server-side against that `ChangeSet`'s own
stored envelope digest (never a caller-supplied one — the confused-deputy fix in
`docs/security-posture.md`), and spent in the same process before the command returns. It is
never printed, so nothing can carry it anywhere. On success the change set is dispatched — and
if the envelope is within the standing policy it runs, while if it is not, dispatch refuses
exactly as §2 describes (approval moved the plan to `ready`; it did not widen the policy).

**Run it in a terminal you opened yourself.** The command refuses a piped stdin, and refuses a
process whose environment carries agent-runtime or CI provenance. `docs/security-posture.md`
records exactly what that does and does not prove.

### 2b. Why a run can finish its work and still not publish

A run reaches `published_local` only if its acceptance criteria were actually
**evaluated** — not merely if the worker said the work was done. A worker that
edited files, reported success, and never ran the tests is refused at the last
gate, and the refusal names what went unchecked:

```
acceptance-evaluated (acceptance) exit 1: the acceptance criteria below were
never evaluated — no granted acceptance-class command ran clean for them
  unevaluated: <requirement id>, <title>, <its acceptance criteria>
  observed:    work unit <id>: npm run test (acceptance) invoked 12x, 0 clean
  satisfiedBy: npm run test
```

Read `observed` first — it says which repair you need:

| what it says                      | what happened                                   | what to do                                           |
| --------------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| `no granted command was invoked`  | the worker never tried                          | check the envelope grants `npm run test`             |
| `invoked Nx, 0 clean`             | it tried and the command never ran              | run that command by hand; the command path is broken |
| `npm run build … 1 clean` only    | it checked the tree compiles, not that it works | a clean build is not a verified change set           |
| `[superseded by a later attempt]` | an earlier attempt verified different code      | the repair attempt must re-run the tests itself      |

**The most common cause is that the project declares no `test` script.** Crabgic
grants `npm run test` only when one exists, so on a project without it a worker
has nothing to verify with and nothing will publish. That is deliberate — the
alternative is a terminal state that means "someone said it was fine".

Owner ruling R5, 2026-08-16. The measurement behind it, including the two runs
that published unverified work before the gate existed, is
`docs/evidence/phase-25/published-unverified.md`.

## 3. Checking status

```
crabgic status [run-id] [--watch] [--json]
```

- With a `run-id`: queries the supervisor's `run.status` operation over the UDS control plane
  and prints the run's current state (`changeSetId`, `runState`, `updatedAt`), followed by a
  **work-unit progress line** read from the journal — how many units have succeeded, are
  running, are parked on a rate limit, or have failed. The run state answers "is it going?";
  this answers "how far has it got?", which is the question a multi-minute run actually
  raises. It counts only units the journal has seen, and says nothing at all when it has seen
  none, because a denominator it cannot know would look authoritative and be wrong.

  `--json` deliberately does **not** carry it: this command's JSON output is literally 05's
  published `RunStatusResultSchema` — the raw UDS result, never re-shaped — and that schema is
  strict. Widening it is a cross-phase interface decision the ledger governs, not something a
  rendering improvement gets to add. A script that needs progress today can read the journal
  through `crabgic evidence`, or the ruling can be asked for.

- `--watch`: streams subsequent status-change events until the process is interrupted
  (Ctrl+C) or the run reaches a terminal state. Which runs actually reach one is §3.1.
- Without a `run-id` (listing every run): **wired** — `registry.runs.list` landed on the supervisor's
  router 2026-07-25 and `runStatusAllCommand` consumes it, printing one line per run or `no runs`.
  (This bullet claimed `NOT_IMPLEMENTED` until 2026-07-28; corrected after running the built binary
  against a live daemon. `--watch` is still deliberately unsupported in this shape — 05 emits per-run
  events, not a registry-wide stream, so watching everything would be a poll loop wearing a subscription's
  clothes. Watching a specific run works.)

```
crabgic cancel <run-id|task-id>
```

Cancels a run (or, once 13's task-level semantics are wired, a single task within it) via the
supervisor's `run.cancel` operation.

### 3.1 How a run ends, and what to do about it

**Every run that stops doing work records how it ended.** Once its DAG has nothing left to
dispatch, the daemon writes the run's own terminal state:

| What the DAG did                                  | Run state                                         |
| ------------------------------------------------- | ------------------------------------------------- |
| A unit failed (alone, or beside successful ones)  | `failed`                                          |
| A unit was cancelled, none failed                 | `cancelled`                                       |
| A failure stranded a unit that can never be ready | `blocked`                                         |
| Every unit succeeded                              | stays `running` — awaiting the verification stage |
| A unit is parked on a rate limit                  | stays `running` — resumable, deliberately         |

The four absorbing states (`published_local`, `failed`, `blocked`, `cancelled`) are what
`status --watch` stops on, and what frees the change set: **retrying is `crabgic run` again**,
which mints a fresh run with its own repair budget. Nothing needs cancelling first.

(Before 2026-08-02 a failed DAG left the run in `running` forever: the change set was refused
with "already has run … in flight", `--watch` never terminated, and `resume` reported success
while doing nothing. `crabgic cancel` was the only escape.)

```
crabgic resume <run-id> [--json]
```

**`resume` re-drives an existing run — it does not retry a finished one.** It is for crash
recovery and for continuing a rate-limit park, and it refuses whenever a re-drive could not
accomplish anything, naming the reason and the one command that works:

- the run already reached an absorbing state — retry with `crabgic run`;
- every unit is terminal but the run is still `running` (a run wedged by the pre-2026-08-02
  defect, or one whose settle write failed) — `crabgic cancel <run-id>`, then `crabgic run`;
- the only remaining work is parked on engine sessions a daemon restart destroyed — likewise
  `crabgic cancel <run-id>`, then `crabgic run`.

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

**Wired and functional in the shipped binary.** All three verbs dispatch to 12's real
`@crabgic/detect` backends (`packages/cli/src/commands/dispatch.ts`), and
`buildRealCliDependencies` supplies that bag by default (`packages/cli/src/bootstrap.ts`), so
none of them returns 09's `NOT_IMPLEMENTED` stub.

> **Correction (2026-08-01).** This section previously said these commands were
> `NOT_IMPLEMENTED` and pointed at an unresolved phase-11 wiring carry-forward. That
> carry-forward was discharged in `01ae7aa` (2026-07-25), one day after this paragraph was
> written, and the guide was never updated — so the guide told operators a working feature was
> unavailable. Pinned end-to-end through the real composition root by
> `packages/cli/src/bootstrap.test.ts`'s "runs `trust review|approve|revoke` end-to-end through
> the SHIPPED wiring" case, which is the coverage whose absence let the claim drift.

- **`crabgic trust review`** lists every audited capability in this project's capability store
  (`$XDG_CACHE_HOME/crabgic/<project-hash>/capability-store/`, interface-ledger Gap 14) with
  its current decision, most-recently-audited first — `[pending] skill "name" — sha256:…`, or
  `no capability audits recorded yet`. `--json` returns the full structured reports.
- **`crabgic trust approve <digest>`** mints a **single-use approval token bound to that
  content digest, and nothing else.** It deliberately does **not** flip any stored decision.
  That separation is the whole control: only `capability.approve`, verifying a token this
  command already minted, can move a capability to `approved` — and `capability.approve` can
  only ever _verify_ a previously human-minted token, never mint one, so it is never
  model-satisfiable. Mirrors `contract.approve`'s own treatment in 11.
- **`crabgic trust revoke <token-id>`** resolves the digest the token was bound to and flips
  that store entry back to `rejected`. It never deletes the audit trail.

Every decision transition these commands cause is appended to 04's hash-chained journal as an
`adjudication_decision` entry **before** the store artifact is rewritten, and a flip that
cannot be journaled is refused outright (interface-ledger Gap 5). This matters operationally:
`report.json` is rewritten in place and holds only the _newest_ decision, so the journal — not
the store — is where the history of who approved or revoked what actually lives.

The approval signing key is durable and project-scoped
(`packages/cli/src/approval/signing-key.ts`, 0600 under the project's XDG state root), so a
token minted by one short-lived `trust approve` invocation does verify in the long-lived
`gateway mcp` process. It is still consumed on first verify; a replay is rejected as a replay.

## 6. Managing external connections

```
crabgic connection add jira|grafana
crabgic connection list
crabgic connection doctor <connection-id>
crabgic connection capabilities <connection-id>
```

**Three of the four are wired and functional in the shipped binary; `connection capabilities`
is not.** `add`/`list`/`doctor` dispatch to `packages/cli/src/connection/connection-commands.ts`
(`packages/cli/src/commands/dispatch.ts`), and `buildRealCliDependencies` supplies that bag by
default (`packages/cli/src/bootstrap.ts`), so none of those three returns 09's
`NOT_IMPLEMENTED` stub.

> **Correction (2026-08-02).** This section previously said all four commands were
> `NOT_IMPLEMENTED` with "no wired backend in this pass". The backend for three of them landed
> in `c720433` (2026-07-25), one day after this section was written, and the guide was never
> updated — so, exactly as in §5, the guide told operators a working feature was unavailable.
> Only the fourth claim was still true, and it is kept below. Both halves are pinned:
> `packages/cli/src/commands/connection-dispatch.test.ts` asserts that the three reach real
> backends with the bag present and that `connection capabilities` stays `NOT_IMPLEMENTED`
> with the bag but no discoverer, and `packages/cli/src/bootstrap.test.ts`'s "wires the real,
> DURABLE connection backend by default — a connection added in one process survives into the
> next" case proves the shipped composition root supplies it.

- **`crabgic connection add jira|grafana`** stores the connection in a durable, file-backed
  `ExternalConnection` store under the project's XDG **state** root (not cache — a configured
  connection is durable state, not a regenerable artifact). Credentials are stored as
  **references only**, never literal values: the argv forms that have a faithful representation
  in 02's `SecretReferenceSchema` (`env:NAME`, `file:///abs/path`) are converted, and every
  other form (`op://…`, `vault://…`, `ref:id`) is refused loudly rather than silently coerced
  into a resolution mechanism you did not ask for.
- **`crabgic connection list`** prints one line per stored connection (id, provider, base URL,
  secret **locator**), or `no external connections configured`. The reference is rendered as its
  locator — the env var name or file path — and is never resolved, so stdout never carries a
  credential. `--json` returns the same redacted projection.
- **`crabgic connection doctor <connection-id>`** runs the gateway's reachability probe
  (`probeConnectionReachability`) against the stored connection end-to-end — a single,
  deliberately GET-only request through the gateway's real transport stack, so the SSRF guard,
  custom-CA-aware HTTPS agent and redirect revalidation are all exercised, and nothing is
  mutated. It never crashes on an unreachable host: a refused SSRF preflight, a TLS failure, a
  timeout, or an unreadable custom CA each come back as an informative `UNREACHABLE` line and a
  non-zero exit, never a raw provider body. The same probe 18/19/20's own doctor checks build on
  (`docs/security-posture.md`, "6. Connectors").
- **`crabgic connection capabilities <connection-id>`** is the one that still returns
  **`NOT_IMPLEMENTED`** at this repository's current build. The backend exists
  (`packages/cli/src/connection/connection-capabilities.ts`); what is missing is the injected
  discovery function, and `bootstrap.ts` deliberately does not supply one because neither
  connector can be completed without inventing something: Jira has no storage for the OAuth
  client-credentials _pair_ (`ExternalConnection` carries exactly one `secretRef`, by a
  roadmap/19 ruling), and Grafana's `buildinfo` response shape is fixture data pending live
  verification against a real server. Leaving it undefined keeps the command visible to
  `e2e/live`'s `NOT_IMPLEMENTED` sweep rather than shipping a command that merely looks wired
  and always fails. It is recorded in that sweep's deferral allowlist
  (`e2e/live/src/knownDeferredAllowlist.ts`).

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

---

## 11b. Journal integrity: writer separation and head anchoring (advanced)

By default crabgic runs entirely as your own user account. That is supported and
is what almost everyone should use — but it means the journal, which is the
system's record of what actually happened, is writable by every process your
account starts, workers included. Two mechanisms exist for deployments that need
more than that. Neither is on by default, and `crabgic doctor` will tell you
plainly which of them is in effect.

**What you are protecting against.** Not a corrupted file — `doctor`'s
`journal.chain` check already catches that. The concern is a _rewrite_: the
chain is a plain SHA-256 with no secret, so anything that can write the segment
files can re-chain a different history from scratch, and chain verification will
report it clean. Detecting that needs something outside the journal.

### Writer separation (ownership)

Run the daemon as its own service account that owns the state root, and leave
workers running as you. A worker then has no write path to the journal at all —
no permission rule and no secret is load-bearing, because the file simply is not
writable by that uid.

Sketch, on a systemd host:

1. Create a service account (for example `crabgic-daemon`) with no login shell.
2. Give it ownership of the project's state root, mode `0700`:
   `chown -R crabgic-daemon $XDG_STATE_HOME/crabgic/<project-hash>`
3. Run the daemon under that account (a systemd unit with `User=crabgic-daemon`).
4. Allow your own uid to reach its control socket — the daemon admits its own
   uid plus any explicitly configured additional uids, and nothing else. An
   empty or absent list behaves exactly like the single-uid default, so this
   never widens a deployment that did not ask for it.

`crabgic doctor` reports which state you are in under `journal.writer-separation`:
it fails only on a journal directory that is group- or world-writable (wrong
under any model), and otherwise tells you whether separation is in effect or
absent.

**Honest limit, worth knowing before you invest in this.** The CLI still writes
the journal directly for intake. Under separation those writes would have to
route through the daemon instead, and that routing does not exist yet — so
today separation protects the journal from _workers_, not from every path the
system itself uses. Full separation is finished when intake writes go over the
control plane.

### Head anchoring (detection)

Record what the journal's head was, somewhere the machine cannot quietly
rewrite. An anchor is a small `(seq, hash)` pair; if the journal no longer
carries that hash at that seq, the history underneath it changed.

Kept beside the journal it is a weak signal — whoever rewrites the segments can
usually rewrite the anchor in the same breath. Its value is that it is small and
copyable: keep a copy off the host (a signed log, a WORM bucket, a git note
pushed to a remote, your own notes), and any holder of an older copy can detect
a rewrite that the machine itself would report as clean. **The primitive is the
anchor; the strength is wherever you keep it.**

`crabgic doctor` reports this under `journal.head-anchor`. With no anchor
recorded it passes and says so — there is simply nothing to compare against
yet.

## 12. What the manager session will and will not stop for

`crabgic install` writes a **manager operating protocol** into your project's `CLAUDE.md`
(and the long form is readable in-session with `/eo:protocol`). It exists because a Claude
Code session with no instructions falls back to checking in after every step, which is the
opposite of what this product is.

### It will not ask you to continue

The manager is expected to drive an approved run to completion on its own initiative. It
should never ask "continue?", "shall I proceed?", or "ready for the next step?", and should
never describe a plan and then wait to be told to run it.

### The only reasons it stops

Seven stop conditions (roadmap/11 — the same list the supervisor enforces in code):

| Condition                        | What it means                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| material amendment               | the work diverged from the approved contract in a way that changes what is being built              |
| expanded authority               | finishing would need a command, path, network destination or credential the envelope does not grant |
| critical security issue          | a vulnerability or exposed secret that must not be worked around                                    |
| unsafe overlap                   | two work units would write the same region and it cannot be ordered away                            |
| **irreducible product decision** | two defensible options, materially different products — **the only one that asks you a question**   |
| exhausted repairs                | the initial attempt plus both evidence-driven repairs are spent                                     |
| blocking verification            | a gate fails in a way no repair can clear                                                           |

Plus the approval gates in §2, §5 and §7, which are a human act by design.

### How it asks

Through Claude Code's structured question interface — several decisions in one prompt, real
options, an "Other" escape hatch, and a free-text notes field. Not a plain-text list of
numbered options. If the question tool is unavailable, it falls back to a single
consolidated question rather than interrogating you step by step.

### The Stop hook, and how to turn it off

The protocol is prose, so the "don't stop mid-run" half is also enforced by a hook. On every
`Stop` event, `stop-autonomy-gate.mjs` asks the supervisor whether a run is still in flight
and, if so, blocks the turn from ending and tells the model to keep working.

It stays out of the way when it should:

- **A run parked at `awaiting_approval` does not block.** You must be able to reach
  `/eo:approve` — blocking there would trap you in a session whose only exit is the thing
  the block prevents.
- **Terminal states do not block** (`published_local`, `failed`, `blocked`, `cancelled`).
- **It fails open, always.** No supervisor, no runs, a timeout, malformed output, an
  unrecognized state — the turn ends normally. It cannot wedge a session, and it does
  nothing at all in a project that has never run Crabgic.
- **It cannot loop.** The engine sets `stop_hook_active` on the re-entered `Stop` event
  (`docs/engine-baseline.md` §19.2) and the gate returns immediately when it sees it.

To disable it, remove the `Stop` entry for `stop-autonomy-gate.mjs` from the plugin's
`hooks/hooks.json`, or disable the plugin's hooks in your `.claude/settings.json`. Removing
it leaves the protocol in place as instructions — you lose the enforcement, not the guidance.

To query run state the way the hook does, without starting a supervisor:

```
CRABGIC_NO_SPAWN=1 crabgic status --json
```

`CRABGIC_NO_SPAWN=1` makes any CLI command connect to an already-running supervisor and fail
fast if there is none, rather than starting one on demand.

---

## Release-candidate evidence anchor (2026-08-06)

Appended by the closeout pass for roadmap/23's release-docs criterion. Everything above is left
byte-identical.

**The release candidate this guide describes** is `6b9dd7b` — published as `crabgic@1.5.0`, the
current `latest` on the public registry. Its CI is run
[30581597639](https://github.com/WitchyNibbles/crabgic/actions/runs/30581597639); its blocking
release gate is job 91004033370 of the tag-gated `publish` run
[30581930006](https://github.com/WitchyNibbles/crabgic/actions/runs/30581930006).

**The anchor rule for the test files this guide cites.** Rather than repeating a run URL beside
every mechanism claim, one statement covers them: each `packages/**` test file named in this
document was checked, file by file, against the release candidate's own
`CI / unit-test+coverage (ubuntu-latest)` job **91002998119** of run 30581597639. This guide
names two, and **both** ran green at the candidate — job-log line 903
` ✓  crabgic  src/bootstrap.test.ts (17 tests) 91ms` and line 922
` ✓  crabgic  src/commands/connection-dispatch.test.ts (8 tests) 30ms`. That job's own totals
are at lines 1008-1009: ` Test Files  605 passed (605)` and
`      Tests  5802 passed | 1 skipped (5803)`. Every quoted line here was re-downloaded and
byte-compared under the one-space rule (ANSI-strip, then strip the timestamp and its ONE
separator space); the comparison is in
`docs/evidence/phase-23/closeout/c14-release-docs-citations.txt`.

**The header's "exactly one command returns `NOT_IMPLEMENTED`" claim, and §5/§6's "wired and
functional" claims**, are the release-gate item `gateway-cli-surface-complete`:
`docs/evidence/phase-23/closeout/release-gate-report-final-6b9dd7b.json:479` is
`      "id": "gateway-cli-surface-complete",` and `:482` is `      "verdict": "PASS",`, over
five linked records carrying `release-gate:not-implemented-sweep`,
`release-gate:gateway-cli-surface-complete` and `release-gate:live-conformance`. §10's
description of the release-gate report is that same committed artifact.

**And what this anchor does not do.** It does not make every claim in this guide
release-candidate-cited. It cannot: the counts are in
`docs/evidence/phase-23/closeout/c14-release-docs-citations.txt`, and they are why roadmap/23's
release-docs box is still unticked.
