# Phase 09 — `crabgic` CLI & doctor

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
- **`gateway mcp`:** boots the `crabgic_gateway` MCP server (stdio) over `packages/gateway`'s (16) extensible tool
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
  **Amended 2026-07-28 (ledger Gap 18): this stops being the routine path.** Under the standing
  `EnvelopePolicy` an in-policy dispatch mints **no token at all**, so this prompt now serves only the
  escalation subjects — an envelope that fails containment, 12's capability quarantine, and 22's learning
  promotion. It remains the sole mint path for those, unchanged in mechanism. The retirement is deliberate:
  in the shipped `1.3.0` binary `run --json` printed the minted token for a caller in another process to
  relay, which in a manager session made the model the courier for a human-approval token.
- **`doctor` renders the standing policy (2026-07-28 — ledger Gap 18).** A check contributed by 10 asserts
  the `EnvelopePolicy` exists, parses, is `0600`, and is untracked by git — and prints it **in full**, since
  an owner cannot review a standing grant they cannot read. Its digest is what 13 journals per dispatch.

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

1. **CLI command surface** (`packages/cli`, binary `crabgic`): `install [--dry-run]
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
- `$XDG_STATE_HOME/crabgic/<project-hash>/…` and `$XDG_CACHE_HOME/crabgic/`
  layout/permission conventions — doctor's XDG-permission checks target these paths directly.
- Journal chain-verification routine — doctor's "torn journal" check calls 04's own verifier, not a
  reimplementation.

**Ambient, via `packages/contracts` (02) — not a direct Depends-on edge, matching the convention already
used by 05/06/07/10/11's own consumption of 02:**
- `GATEWAY_MCP_SERVER_NAME = "crabgic_gateway"` — `gateway mcp`'s server identity.
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
`.mcp.json` entry uses (`crabgic gateway mcp`).

**Security:** secret value in argv rejected with guidance, never echoed in output, logs, or doctor evidence;
approval-token replay (same token verified twice) fails closed; token minting is reachable only through the
terminal-prompt renderer, never a bare flag or a scripted non-interactive path; doctor's auth probe prints
only a validity verdict, never the resolved token value.

## Exit criteria

**Closeout pass 2026-08-02:** 6/7 ticked against recorded evidence; the 1 unticked box below is an
open defect — see `docs/evidence/criteria-closeout/defects/09-json-output-snapshot-coverage.md` and
that box's own note. Machine-readable index: `docs/evidence/criteria-closeout/phase-09.json`.

Shared citations reused by several boxes below. **`CI` run
[30720547145](https://github.com/WitchyNibbles/crabgic/actions/runs/30720547145)**, green at
`af46e00` — its `unit-test+coverage (ubuntu-latest)` job
([91423926933](https://github.com/WitchyNibbles/crabgic/actions/jobs/91423926933)), step "test with
80% line+branch coverage gate", executed 623 test files / 6060 tests, and the step log names every
suite cited below individually. Two suites cited here live in `e2e/live`'s **offline** default
project (`src/gatewayFamilyCompleteness.test.ts`, `src/cliNotImplementedSweep.test.ts`) and are
therefore NOT part of `npm test`'s fan-out; they were re-run locally at the closeout commit. Scoped
local re-runs of every criterion's own suites, captured verbatim, are committed as
`docs/evidence/phase-09/closeout-c<k>-*.txt`.

Two notes a reader of this section needs. (a) `docs/evidence/phase-09/README.md` pre-dates the
`@eo/*` → `@crabgic/*` rename, a relocation and a deletion, so **five** of the `packages/cli` test
paths it names no longer resolve — `src/approval/token.test.ts` and
`src/approval/approval-token.property.test.ts` (moved verbatim to `@crabgic/contracts` in `5c21a0f`),
`src/gateway-mcp/gateway-mcp.boot.test.ts` and `src/gateway-mcp/registry.test.ts` (deleted in
`c39292c`), and `src/commands/dispatch.test.ts` (renamed to `cli.commands.schema.test.ts`, which the
README's own table records but its §Deviations item 5 still cites under the old name). Each box
below cites the path at HEAD, and every relocation is recorded in this pass's index.
(b) This phase's §In scope `NOT_IMPLEMENTED` machinery is still real, but its surface has shrunk to
one command — see the note under criterion 1.

- [x] Every plan CLI command exists as a typed UDS request with stable exit codes; `--json` validates
      against published schemas — suite `cli.commands.schema.test`. — **Evidence (2026-08-02):**
      `packages/cli/src/argv/parse-command.test.ts` parses every command §In scope names, one case
      per family (`:249` `expect(parseCommand(["gateway", "mcp"])).toEqual({ command: "gateway-mcp" })`,
      plus `install`/`doctor`/`status`/`resume`/`cancel`/`evidence`/`approve`/`connection *`/`trust *`/
      `learn *`/`upgrade`/`uninstall`), and `:269`/`:273` reject an unknown command and a malformed
      flag so the union is not open. `packages/cli/src/commands/cli.commands.schema.test.ts` drives
      the real `dispatchCommand` against a **real supervisor** started in a tmp dir (`:65-70`
      `startSupervisorServer`): `:98` `expect(() => RunStatusResultSchema.parse(JSON.parse(result.stdout!))).not.toThrow()`
      and `:107` the same for `RunCancelResultSchema` — 05's own **published** zod schemas, not
      snapshots; `:230-236` asserts the typed `NOT_IMPLEMENTED` shape and `EXIT_NOT_IMPLEMENTED` for
      all 16 unwired-bag command variants; `:262` maps an unreachable supervisor to
      `EXIT_SUPERVISOR_UNAVAILABLE`; `:148-151` proves `resume` genuinely round-trips to the daemon
      (`expect(result.exitCode).not.toBe(EXIT_NOT_IMPLEMENTED)` and the refusal names the missing
      dispatcher) rather than short-circuiting in the CLI. The stable set itself is
      `packages/contracts/src/cli-surface/exit-codes.ts`, re-exported verbatim by
      `packages/cli/src/exit-codes.ts`. `CI` run 30720547145 green at `af46e00`;
      `docs/evidence/phase-09/closeout-c1-cli-commands-schema.txt`.
      **Wording corrected 2026-08-02.** The clause read "exists as a typed **UDS request**". Most of
      this surface is not a UDS request and never was: `doctor` runs local host probes, `evidence`
      reads 04's journal directly through `JournalStore`, and every family wired after this phase
      (`trust *`, `connection *`, `learn *`, `install`/`upgrade`/`uninstall`) has a local backend.
      `status`/`cancel`/`resume` are the UDS-backed commands, and those are exactly the ones the
      suite round-trips against a real supervisor. The corrected claim is *more precise, not weaker*:
      the guarantee the box carries — every plan command exists, is typed, returns one of the stable
      exit codes rather than crashing or an untyped error, and its `--json` validates against a
      published schema wherever one exists — is fully evidenced above. The checks are unchanged.
      Scope note on the `NOT_IMPLEMENTED` surface, recorded because this phase owns it: in the
      *shipped* binary only `connection capabilities` still returns it. `packages/cli/src/bootstrap.ts`
      supplies `installer`/`intake`/`trust`/`connection`/`learning`, asserted against the real
      composition root by `e2e/live/src/cliNotImplementedSweep.test.ts:99-106`, and `:208-247` folds
      the dispatch-level sweep with that real wiring to `expect(realGaps).toEqual(["connection-capabilities"])`.
- [x] `gateway mcp` starts and lists exactly the resolved tool set over stdio to a stub MCP client — the
      exact process 10's `.mcp.json` entry (`crabgic gateway mcp`) invokes; full 8-family
      completeness remains a phase-23 release gate — suite `gateway-mcp.boot.test`. — **Evidence
      (2026-08-02):** `packages/gateway/src/mcp/server.test.ts:106-121` spawns a **real child
      process** over stdio (`StdioClientTransport`, `command: process.execPath`) and connects the
      **real MCP SDK `Client`** as the stub client, then asserts
      `expect(tools.map((t) => t.name).sort()).toEqual([...NATIVE_TOOL_NAMES].sort())` — *exactly*
      the resolved set, and `:123-140` re-runs it with one externally-registered tool to prove the
      set tracks the registry rather than a constant. `packages/gateway/src/mcp/stdio-boot.test.ts`
      covers the boot itself: `:82` `expect(result.serverInfo.name).toBe(GATEWAY_MCP_SERVER_NAME)`,
      `:91` `expect(listed.map((t) => t.name)).toEqual(["probe.echo"])`, `:134` an empty registry
      lists `[]` without crashing, `:99-111` a real `tools/call` round-trip.
      `packages/contracts/src/gateway/tool-registry.test.ts:23` keeps duplicate-name registration
      rejected. The *resolved production* set is pinned at
      `packages/cli/src/gateway-mcp/build-tool-registry.test.ts:138`
      (`expect([...realRegistry().toolNames].sort()).toEqual([...EXPECTED_TOOL_NAMES].sort())`) and
      re-derived behaviourally over the real MCP stdio server by
      `e2e/live/src/gatewayFamilyCompleteness.test.ts:23-29`/`:125-130`. The "exact process" clause is
      byte-compared at `packages/cli/src/installer/mcp-entry.golden.test.ts:37`
      (`expect(JSON.stringify(result.mcpJson.mcpServers)).toBe(expectedJson)` against
      `{"crabgic_gateway":{"command":"crabgic","args":["gateway","mcp"]}}`) and
      `packages/cli/src/commands/cli.snapshots.test.ts:68`/`:74`/`:80`. The 8-family clause is
      discharged by phase 23's ticked "Full 8-family gateway MCP tool surface + full CLI surface
      return real behavior" box. `CI` run 30720547145 green at `af46e00`;
      `docs/evidence/phase-09/closeout-c2-gateway-mcp-boot.txt`,
      `docs/evidence/phase-09/closeout-c2-family-completeness.txt`.
      **Wording corrected 2026-08-02.** The named suite `gateway-mcp.boot.test` no longer exists:
      `c39292c` ("retire the hand-rolled MCP server") deleted
      `packages/cli/src/gateway-mcp/{protocol,stdio-server}.ts` and their tests when production
      stopped booting them. The evidence channel is now `packages/gateway/src/mcp/server.test.ts` +
      `packages/gateway/src/mcp/stdio-boot.test.ts`, and the substitution is *strictly stronger*, not
      a downgrade: the retired suite drove a hand-rolled ndjson subset over in-process streams that
      answered every `tools/call` with `METHOD_NOT_FOUND` and replied to notifications it should have
      ignored; the replacements drive a real OS child process, the real MCP SDK client, and a real
      `tools/call`. The criterion's own claim is unchanged and remains fully asserted.
- [x] Doctor detects each seeded fault (wrong engine version, missing bwrap, rogue settings, bad socket
      perms, torn journal) with a correct repair plan — suite `doctor.fault-matrix.test`. —
      **Evidence (2026-08-02):** `packages/cli/src/doctor/doctor.fault-matrix.test.ts` seeds all five
      named faults and asserts `passed:false` on each: `:58-66` wrong engine version (evidence names
      the observed `1.0.0`, `repairStep` defined); `:68-78` missing bwrap
      (`expect(finding.repairStep).toContain("bubblewrap")`); `:80-91` rogue settings
      (`expect(finding.evidence).toContain("influenced the run")`); `:115-136` bad UDS socket perms —
      a **real** UDS socket bound at `resolveSupervisorSocketPath`'s exact path, mis-chmodded to
      0755, run through `buildDefaultDoctorChecks`'s own production wiring, asserting the evidence
      names the path, `0755` and `0600`; `:139-166` and `:168-191` torn journal, both variants,
      pinning that the tail case offers `repairJournal` while the mid-journal case says
      "NOT a safe auto-repair" **and** that neither classification's evidence string can be swapped
      for the other's. The anti-vacuity controls are explicit: `:193-197` asserts each fixture yields
      *no* finding before its check is registered, and `packages/cli/src/doctor/framework.test.ts:57-67`
      pins that `buildRepairPlan` lists only failing checks carrying a repair step, in order, and
      never executes anything. The hermeticity probe — the one previously found vacuous — is now
      structurally pinned by `packages/cli/src/doctor/checks/hermeticity-selftest.test.ts:71-99`,
      which asserts the exact `cwd`/`env` reaching the spawn
      (`expect(Object.keys(capturedEnv!).sort()).toEqual(["CLAUDE_CONFIG_DIR", "HOME", "PATH"])`, so
      the real ambient env cannot be merged in and the planted `CLAUDE.md` is genuinely in scope).
      `CI` run 30720547145 green at `af46e00`;
      `docs/evidence/phase-09/closeout-c3-doctor-fault-matrix.txt`. Scope note: the fault-matrix cases
      pin the `repairStep` string for bwrap, both journal variants, and (via
      `:239-259`) the xdg-permissions check that owns the socket case; the engine-version case asserts
      only that a repair step exists, and the rogue-settings case asserts the evidence rather than its
      repair step. Both repair steps exist in the checks; they are simply less tightly pinned.
- [x] Secret value in argv rejected with guidance, never echoed in output or evidence — suite
      `secret-ref.rejection.test`. — **Evidence (2026-08-02):**
      `packages/cli/src/argv/secret-ref.rejection.test.ts:45-55` — a `ghp_`-shaped literal throws
      `SecretValueRejectedError` with `expect((err as Error).message).not.toContain(secret)` and
      `expect((err as Error).message).toContain("--token")`, i.e. rejected *with guidance* and never
      echoed; `:34-43` covers a high-entropy token and a bare JWT; `:57-61` closes the default —
      only recognised reference forms are accepted at all. `:6-32` is the negative control: all five
      reference forms (`env:`, `op://`, `vault://`, `file:///`, `ref:`) parse, so a rejector that
      rejected everything would fail. `packages/cli/src/argv/secret-reference.property.test.ts` runs
      the same three properties under fast-check at 500 runs each, including `:45`
      `expect((err as Error).message).not.toContain(candidate)` over every known-provider prefix.
      The boundary is end-to-end: `packages/cli/src/argv/parse-command.test.ts:174` rejects
      `connection add` carrying a literal secret, and `packages/cli/src/cli-entry.test.ts:36-44`
      maps that to `EXIT_SECRET_REJECTED` through the real `runCliEntry`. For "never echoed in
      **evidence**", `doctor.fault-matrix.test.ts:381-386` asserts the auth probe's passing evidence
      is exactly `"subscription auth is valid"` with no `repairStep` and nothing about the credential.
      `CI` run 30720547145 green at `af46e00`;
      `docs/evidence/phase-09/closeout-c4-secret-ref-rejection.txt`.
- [x] Approval token verifies once, expires, and binds to the exact digest it was minted against — suite
      `approval-token.property.test`. — **Evidence (2026-08-02):**
      `packages/contracts/src/approval/approval-token.property.test.ts` — the suite named by this
      criterion, relocated verbatim from `packages/cli/src/approval/` to `@crabgic/contracts` in
      `5c21a0f` to break a `cli → learning → gates → detect → cli` cycle. All three clauses are
      fast-check properties at 200 runs each over randomised `(subjectKind, digest)`: `:19-35`
      single-use (the first `verify` is *un*-caught, so a token that never verified at all would fail
      the test — that is the positive control the "never again" assertion needs); `:37-59`
      digest-binding, with `fc.pre` excluding only the exact minted pair so every other
      `(kind, digest)` must fail; `:61-87` expiry under an injected clock. Deterministic companions in
      `packages/contracts/src/approval/token.test.ts`: `:59-70` a tampered signature and a
      cross-minter key both fail closed, `:80-93` minting twice against the same pending digest does
      not double-journal, `:96-110` re-minting after consumption does. `CI` run 30720547145 green at
      `af46e00`; `docs/evidence/phase-09/closeout-c5-approval-token.txt`.
- [x] `evidence <change-set-id>` returns every journaled `EvidenceRecord` for that ChangeSet, including
      rendered PR-title/PR-body/review-comment artifacts once 17 populates them, and an empty-but-valid
      report before any exist — suite `evidence.query.test`. — **Evidence (2026-08-02):**
      `packages/cli/src/evidence/evidence.query.test.ts:28-34` — a fresh ChangeSet yields
      `expect(report).toEqual({ changeSetId: "…", records: [] })`, an empty-but-valid report rather
      than a throw; `:36-51` returns the journaled record for the queried ChangeSet **and none for a
      second one**; `:67-77` returns multiple records in journal order; `:53-65` proves the entry-type
      filter is real (a `run_transition` entry yielded under the same filter is still excluded), which
      is what makes the admit-set exactly `evidence_pointer`. The command path is exercised
      end-to-end in `packages/cli/src/commands/cli.commands.schema.test.ts:169-179` against a real
      journal. The "including rendered PR-title/PR-body/review-comment artifacts" clause is the
      mechanism interface-ledger Gap 6 rules on — 08 "wraps each lint-passed `RenderedArtifact` in an
      `EvidenceRecord`, and journals an `evidence_pointer` entry against the ChangeSet; a human
      retrieves them via Phase 09's `evidence <change-set-id>` command — there is no other delivery
      path" — and both halves are asserted: `packages/git-engine/src/evidence-attachment.test.ts:53-85`
      attaches exactly one `EvidenceRecord` per `pr_title`/`pr_body`/`review_comment`, each with the
      queried `changeSetId` and a distinct artifact digest, and confirms three `evidence_pointer`
      entries are journaled against it, while `queryEvidence` applies no filter beyond that type and
      ChangeSet id. The composed claim is separately discharged live by phase 23's ticked "evidence
      bundle (rendered PR-title/PR-body/review-comment artifacts retrievable via
      `evidence <change-set-id>`)" box. `CI` run 30720547145 green at `af46e00`;
      `docs/evidence/phase-09/closeout-c6-evidence-query.txt`.
- [ ] Help text and every `--json` output schema are snapshot-stable — suite `cli.snapshots.test`.
      — **Left unticked 2026-08-02, defect filed:**
      `docs/evidence/criteria-closeout/defects/09-json-output-snapshot-coverage.md`. The help half is
      fully met: `packages/cli/src/commands/cli.snapshots.test.ts:19-40` snapshots top-level help in
      both human and `--json` form plus a per-topic snapshot for every key of `COMMAND_HELP` (15
      topics in the committed `.snap`, 19 entries in total). The "every `--json` output schema" half
      is not: the committed
      snapshot file holds exactly three non-help entries — the `NOT_IMPLEMENTED` shape and two
      `gateway mcp` tool-listing shapes — and no snapshot exists for `doctor --json`,
      `evidence --json`, or any of the `--json` outputs of the command families wired after this phase.
      This is original, not drift: the same three entries are all that `d0f29c8` (this phase's own
      landing commit) committed. `docs/evidence/phase-09/README.md`'s claim that snapshot stability is
      the conformance mechanism "for those three" (`evidence`/`doctor`/`NOT_IMPLEMENTED`) overstates
      what the suite does. Correcting the wording here would delete the word "every", which is a lost
      guarantee rather than a clarification, so the wording protocol does not apply. Adjacent
      (non-snapshot) pins that limit the blast radius are recorded in the defect. Remedy is S-sized
      and needs neither CI nor the live engine.

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
