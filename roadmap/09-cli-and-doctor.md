# Phase 09 — `engineering-orchestrator` CLI & doctor

| | |
|---|---|
| **Depends on** | 05 |
| **Unlocks** | 10, 11, 12 |
| **Sources** | original plan "Public interfaces → CLI"; adaptation §4.6 (version discipline, doctor), §5.5 (approval flow, gateway MCP tool list), §6.1 (`gateway mcp` `.mcp.json` invocation literal), Appendix A (verified CLI flags); `docs/engine-baseline.md` (00 output, doctor's version-gate citation) |
| **Primary package** | `packages/cli` |

## Goal

Every CLI command named in the plan exists as a typed, `--json`-capable command wired to the supervisor
(05) over UDS — including `gateway mcp`, the literal stdio entry point phase 10's `.mcp.json` invokes, which
no earlier draft of this phase declared — plus a doctor that validates the host end-to-end against seeded
fault fixtures, and an approval-token minting primitive no model-driven call can satisfy on its own. Before
this phase, no CLI process exists and phases 10/11/12 have nothing to attach real behavior to; after it,
each of those three phases replaces a named, individually testable `NOT_IMPLEMENTED` stub with its own
backend, and the CLI and the plugin (10) behave identically by construction because both sit atop this one
typed client.

## In scope

- **Commands:** `install [--dry-run] [--json]`, `doctor [--repair-plan] [--json]`, `run`,
  `status [run-id] [--watch] [--json]`, `resume <run-id>`, `cancel <run-id|task-id>`,
  `evidence <change-set-id>`, `connection add jira|grafana / list / doctor <id> / capabilities <id>`,
  `trust review|approve|revoke`, `learn list|approve|reject|rollback`, `upgrade [--dry-run]`,
  `uninstall [--keep-state]`, **`gateway mcp`**. Backends not yet built by a landed phase return typed
  `NOT_IMPLEMENTED` until wired (full wiring across the whole surface is a phase-23 release gate).
- **`gateway mcp`:** boots the `eo_gateway` MCP server (stdio) over `packages/gateway`'s (16) extensible tool
  registry, addressed by the `GATEWAY_MCP_SERVER_NAME` constant (02). At 09/16 build time this exposes 16's
  natively-owned tool families (`tracker.*`, `observability.*`). 11 and 12 — already dependents of this
  phase — each register their own already-built handlers (`project.inspect`/`contract.approve`;
  `capability.audit`/`capability.approve`) into the same registry when those phases land, with no new
  cross-phase dependency edge required. No `change_set.*` or `learning.*` tool family exists anywhere, and
  this command never grows one.
- **`evidence <change-set-id>`:** a real query over 04's journal from this phase's own build onward — not a
  `NOT_IMPLEMENTED` stub. Returns every journaled `EvidenceRecord` (02) for that `ChangeSet`, including
  rendered PR-title/PR-body/review-comment `RenderedArtifact`s (17) once attached to the ChangeSet's
  evidence bundle — the human-facing handoff copy is retrieved here, never auto-posted anywhere. Content is
  sparse before 11 creates `ChangeSet`s and before 14/21 populate richer evidence types; it degrades
  gracefully the same way 11's `project.inspect` does, rather than erroring.
- **Conventions:** stdout = result (human or `--json`), stderr = diagnostics; stable exit codes; secret
  values in argv rejected (references only).
- **Doctor checks:** engine present + version within baseline range (`docs/engine-baseline.md`, 00 —
  citation only, see Interfaces consumed); `bwrap` + sandbox self-test (probe worker asserts confinement);
  hermeticity self-test (planted rogue settings must not load); auth probe (subscription token valid, value
  never printed); git version/plumbing; XDG dirs 0700/0600; journal chain verify; WSL2 warnings (`/mnt/c`
  state dirs, Windows-binary exclusions); `--repair-plan` emits ordered non-destructive steps (never
  auto-executes).
- **Approval UX foundation:** terminal prompt rendering an arbitrary digest and minting a one-time HMAC
  token bound to it, journaled as `approval_token_mint` (`JournalEntryType`, 02) — the human-only gate; no
  model-driven call can mint one. Reused for two distinct subjects: 11's envelope hash and 12's capability
  digest (see Risks for the payload-discrimination obligation this creates).

## Out of scope

- Supervisor UDS protocol, registries, worker lifecycle themselves (05) — this phase is a thin typed client
  over them, never re-implements them.
- `gateway mcp`'s registered tool *implementations* — `tracker.*`/`observability.*`/`evidence.get`/
  `evidence.attach`/`result.submit`/forwarded `run.status`/`run.cancel` (16), `project.inspect`/
  `contract.approve` (11), `capability.audit`/`capability.approve` (12) — this phase only boots the stdio
  process over the registry those phases populate.
- IntentContract/AuthorizationEnvelope/CapabilityManifest assembly and the approval content itself (11) —
  this phase supplies only the generic mint/verify/expire primitive and the terminal rendering surface.
- Plugin packaging, `.mcp.json`/`CLAUDE.md`/`.claude/settings.json` authoring, marketplace distribution (10)
  — this phase's `install`/`upgrade`/`uninstall` are stubs 10 replaces with real backends.
- Stack detection and the capability-quarantine pipeline itself (12) — `trust review|approve|revoke`'s
  shape is a stub 12 replaces.
- Scheduler dispatch, task packets, limit parking (13) — `resume`/`cancel`'s full run/session semantics land
  in 06 (session resume) and 13 (parked-work-unit re-dispatch, task-level cancellation); this phase defines
  only the command shape and UDS plumbing.
- Quality/security gate execution and `EvidenceRecord` emission (14), connector evidence integration (21) —
  `evidence`'s content originates there; this phase only retrieves and renders it.
- Connector transport, capability snapshots, connection doctor/capabilities logic (16, 18, 19, 20) —
  `connection add|list|doctor|capabilities`'s real behavior is a stub those phases replace.
- Learning pipeline state machine, promotion/review logic (22) — `learn`'s real behavior is a stub 22
  replaces.
- Renderer/lint templates for PR title/body/review comment (17) — this phase only retrieves and displays
  already-rendered `RenderedArtifact`s via `evidence`.

## Interfaces produced

1. **CLI command surface** (`packages/cli`, binary `engineering-orchestrator`): `install [--dry-run]
   [--json]`, `doctor [--repair-plan] [--json]`, `run`, `status [run-id] [--watch] [--json]`,
   `resume <run-id>`, `cancel <run-id|task-id>`, `evidence <change-set-id>`,
   `connection add jira|grafana / list / doctor <id> / capabilities <id>`, `trust review|approve|revoke`,
   `learn list|approve|reject|rollback`, `upgrade [--dry-run]`, `uninstall [--keep-state]`, `gateway mcp` —
   consumed verbatim by 10 (`install`/`upgrade`/`uninstall` backends; `.mcp.json`'s `gateway mcp`
   invocation), 11 (`run`'s pre-dispatch intake→contract→approval sequence), 12 (`trust
   review|approve|revoke` backend), and re-verified (zero `NOT_IMPLEMENTED` remaining anywhere) by 23.
2. **Typed UDS client** (parser + contract-typed request/response over 05's protocol) — consumed by 10/11/12
   for their own command backends; no phase builds a second client.
3. **`gateway mcp` extensible tool registry** — the stdio process this command boots exposes a tool
   registry; 16's native families populate it, 11 registers `project.inspect`/`contract.approve` into it,
   12 registers `capability.audit`/`capability.approve` into it, each at its own build time with no new
   dependency edge for 11/12. The exact code-level mechanism connecting 16's families to this registry is
   flagged as unresolved in Risks. Consumed by 10 only as the literal invocation target of its `.mcp.json`
   entry.
4. **Doctor framework**: `check = {id, severity, evidence, repair step}` + `--repair-plan` (ordered,
   non-destructive, never auto-executed) — consumed by 10 (registers checksum-drift/plugin-trust/
   manifest-digest checks) and re-run wholesale at 23's release gate.
5. **Secret-reference argument type** + argv validation (rejects literal secret values, references only) —
   consumed by 10 (installer commands conform) and by every command that later accepts a connection/
   credential reference.
6. **Approval-token minting primitive**: terminal-prompt rendering of an arbitrary digest + single-use HMAC
   token bound to it, journaled as `approval_token_mint` (`JournalEntryType`, 02) — consumed by 11
   (envelope-hash-bound token gating `awaiting_approval → ready`) and by 12 (capability-digest-bound token
   for `trust approve`, a distinct subject sharing the same journal entry type per 12's own text).
7. **stdout/stderr/exit-code conventions** (stdout = result, stderr = diagnostics, stable exit codes) —
   every command backend, present or later-wired, conforms to these rather than redefining them.

## Interfaces consumed

**From 05 (`packages/supervisor`, direct dependency):**
- UDS API: ndjson request/response + server-push events, socket 0600 in 0700 dir, `SO_PEERCRED` uid check,
  versioned handshake — this phase's typed client speaks this protocol.
- Contract-typed router ops `run.status`, `run.cancel` — back `status`/`cancel` directly.
- Registries (runs, change sets, work units, workers incl. engine `session_id`, artifact index) —
  `status`/`evidence`/`resume` read through these.

**Transitively via 05 → 04 (`packages/journal`), no additional dependency edge needed:**
- `$XDG_STATE_HOME/engineering-orchestrator/<project-hash>/…` and `$XDG_CACHE_HOME/engineering-orchestrator/`
  layout/permission conventions — doctor's XDG-permission checks target these paths directly.
- Journal chain-verification routine — doctor's "torn journal" check calls 04's own verifier, not a
  reimplementation.

**Ambient, via `packages/contracts` (02) — not a direct Depends-on edge, matching the convention already
used by 05/06/07/10/11's own consumption of 02:**
- `GATEWAY_MCP_SERVER_NAME = "eo_gateway"` — `gateway mcp`'s server identity.
- `JournalEntryType` member `approval_token_mint` — the entry type the minting primitive writes, for both
  11's and 12's tokens.
- `EvidenceRecord`, `ChangeSet` schemas — `evidence <change-set-id>`'s read surface.
- `WorkUnitAttemptStatus` (incl. `parked:rate_limit`, and a likely `cancelled` member per the rationale that
  already cites this phase's own `cancel <run-id|task-id>` command as evidence that cancellation is
  WorkUnit-scoped, not only run-scoped) — `status --watch`'s renderer distinguishes a parked/cancelled work
  unit from a running one.
- Run-lifecycle states (`draft` … `published_local`, terminals `failed|blocked|cancelled`) — `status`/
  `cancel` render and act on these.

**Doc citation only, no code dependency, per the README's "anything engine-touching cites
`docs/engine-baseline.md`" ground rule:**
- `docs/engine-baseline.md` (00) — tested Claude Code version + accepted range for doctor's version-gate
  check. 00's own text names this phase as a consumer of that document; there is no dependency-graph edge
  from this phase to 00 or to 06 (which enforces the same range in code) — doctor's check is a host-level
  `claude --version` probe against the recorded range, not an import of 06's `EngineAdapter`.

## Work items

1. Parser + command skeletons for every declared command (incl. `gateway mcp`'s CLI-level entry and help
   text) + typed UDS client. Failing-first: invoking a command with no backend registered yet returns the
   exact `NOT_IMPLEMENTED` typed shape, not a crash or an untyped error.
2. `gateway mcp`: stdio MCP server boot + extensible tool registry keyed by `GATEWAY_MCP_SERVER_NAME` (02).
   Failing-first: booting against an empty registry lists zero tools without crashing; registering a fake
   tool makes it visible over stdio to a stub MCP client; a duplicate tool-name registration is rejected.
3. `status --watch` event-stream renderer, incl. `WorkUnitAttemptStatus`-aware rendering. Failing-first: a
   scripted `parked:rate_limit` event renders distinctly from `running`/`failed`.
4. Doctor framework (`check = id, severity, evidence, repair step`) + every check named above. Failing-first:
   each seeded fault fixture produces no finding because its check isn't registered yet.
5. Secret-reference argument type + validation. Failing-first: a literal secret-shaped value in argv is
   accepted by a stub parser that doesn't yet reject it.
6. Approval prompt + HMAC token minting bound to an arbitrary digest, journaled as `approval_token_mint`.
   Failing-first: minting twice against the same digest without an intervening verify does not
   double-journal; verifying with the wrong digest fails closed.
7. `evidence <change-set-id>` query over 04's journal. Failing-first: querying a fresh `ChangeSet` fixture
   with zero records returns an empty-but-valid report, not an error.
8. Help text + JSON output schemas, snapshot-tested across every command including `gateway mcp`.

## Test plan

This phase owns, in part, two of adaptation §9's new test-matrix categories — **Hermeticity** (doctor's
self-test, alongside 03/06's compiler/runtime pieces) and **Version drift** (doctor's version-gate check,
alongside 06's adapter-level gate) — both are exercised below and closed in Exit criteria, not deferred.

**Unit:** command-parser argument validation (secret-reference rejection, malformed flags); doctor
check-registration shape validation; HMAC token unit (digest binding, single-use, expiry); `gateway mcp`
registry lookup (empty, single fake tool, duplicate-name rejection).

**Property:** fast-check over random argv permutations — no secret-shaped value ever reaches a subprocess
env or a logged string; approval-token properties (single-use, expiry, digest-binding) hold under
randomized digest sequences, exercised here against the primitive in isolation before 11/12 exercise it
end-to-end against their own subjects.

**Integration:** failing-first command-level integration against a real supervisor (05) in tmp dirs,
covering every command's happy path and its `NOT_IMPLEMENTED` shape where no backend is wired yet;
`gateway mcp` boot against a stub MCP client listing exactly a fake registry's tools; doctor fault-fixture
matrix (wrong engine-version string, missing `bwrap`, rogue settings file present, bad UDS socket
permissions, torn journal segment) — each fixture is seeded before its check is registered and must fail
red first.

**Conformance:** snapshot tests for help text and every `--json` output schema, including `gateway mcp`'s
tool-listing shape; `gateway mcp`'s stdio boot invocation is byte-compared against the exact string 10's
`.mcp.json` entry uses (`engineering-orchestrator gateway mcp`).

**Security:** secret value in argv rejected with guidance, never echoed in output, logs, or doctor evidence;
approval-token replay (same token verified twice) fails closed; token minting is reachable only through the
terminal-prompt renderer, never a bare flag or a scripted non-interactive path; doctor's auth probe prints
only a validity verdict, never the resolved token value.

## Exit criteria

- [ ] Every plan CLI command exists as a typed UDS request with stable exit codes; `--json` validates
      against published schemas — suite `cli.commands.schema.test`.
- [ ] `gateway mcp` starts and lists exactly the resolved tool set over stdio to a stub MCP client — the
      exact process 10's `.mcp.json` entry (`engineering-orchestrator gateway mcp`) invokes; full 8-family
      completeness remains a phase-23 release gate — suite `gateway-mcp.boot.test`.
- [ ] Doctor detects each seeded fault (wrong engine version, missing bwrap, rogue settings, bad socket
      perms, torn journal) with a correct repair plan — suite `doctor.fault-matrix.test`.
- [ ] Secret value in argv rejected with guidance, never echoed in output or evidence — suite
      `secret-ref.rejection.test`.
- [ ] Approval token verifies once, expires, and binds to the exact digest it was minted against — suite
      `approval-token.property.test`.
- [ ] `evidence <change-set-id>` returns every journaled `EvidenceRecord` for that ChangeSet, including
      rendered PR-title/PR-body/review-comment artifacts once 17 populates them, and an empty-but-valid
      report before any exist — suite `evidence.query.test`.
- [ ] Help text and every `--json` output schema are snapshot-stable — suite `cli.snapshots.test`.

## Risks & open questions

- **Two token subjects, one journal entry type:** 11's envelope-hash-bound token and 12's capability-digest-
  bound token both journal as `approval_token_mint` (`JournalEntryType`, 02). This phase's own minting
  primitive must carry an explicit subject-kind discriminator in the entry payload so a capability-digest
  token can never verify against an envelope-hash check or vice versa — a concrete design obligation owed by
  this phase's own implementation, distinct from 12's separately-flagged concern that capability-audit
  pass/fail decisions themselves have no dedicated journal entry type at all.
- **How 16's tool families physically reach this phase's registry is not fully specified:** 11/12's
  registration needs no new dependency edge because both already depend on this phase, but 16 has no
  dependency edge to this phase in either direction in the README graph, and no source text addresses how
  `packages/gateway`'s code reaches a registry `packages/cli` exposes without one. This phase's own exit
  criteria are satisfiable against a stub/fake registry and don't require resolving this; whoever lands 16,
  or 23's final wiring pass, must settle the actual composition point (e.g. a top-level entry point importing
  both packages) — flagged here rather than silently assumed either way.
- **Backend-wiring phases without a declared dependency edge back to this one:** `connection
  add|list|doctor|capabilities` (16, 18, 19, 20) and `learn list|approve|reject|rollback` (22) are wired by
  phases that do not list this phase in their own Depends-on, unlike 12 and 10 which do. This mirrors the
  same stub-now/wire-later/23-gates-completeness convention this phase already applies to `gateway mcp` —
  noted explicitly so the reconciler reads it as an existing, deliberate convention rather than an omission
  introduced by this rewrite.
- **Doctor's version-gate check is a doc citation, not a code dependency:** if `docs/engine-baseline.md`'s
  (00) format changes, this check must be updated by cross-reference, not by import; this phase never treats
  any of 00's `UNRESOLVED:`-marked verdicts as settled beyond what 00 itself records.
- **`evidence`'s graceful degradation mirrors 11's `project.inspect` precedent:** an empty report before
  `ChangeSet`s exist or before 14/17/21 populate richer evidence types is correct behavior, not a bug —
  tested explicitly (work item 7), not merely assumed.
