# Phase 09 evidence — `engineering-orchestrator` CLI & doctor

Governing spec: `roadmap/09-cli-and-doctor.md`. Package: `packages/cli`. Raw gate output
(`tsc -b`, `vitest run`, `eslint`, scoped coverage) captured verbatim in `gate-results.txt`.

## Exit criterion → evidence mapping

| Exit criterion | Suite named in spec | Test files (evidence) |
|---|---|---|
| Every plan CLI command exists as a typed UDS request with stable exit codes; `--json` validates against published schemas | `cli.commands.schema.test` | `src/argv/parse-command.test.ts` (every command's shape); `src/commands/cli.commands.schema.test.ts` (real backends + all 16 `NOT_IMPLEMENTED` stubs, exit codes, **real `RunStatusResultSchema`/`RunCancelResultSchema` zod validation** of `status`/`cancel --json`, not just snapshot stability); `src/exit-codes.ts` (the stable set) — file renamed 2026-07-24 from `dispatch.test.ts` to the exact spec suite name |
| `gateway mcp` starts and lists exactly the resolved tool set over stdio to a stub MCP client | `gateway-mcp.boot.test` | `src/gateway-mcp/gateway-mcp.boot.test.ts` (empty registry → zero tools; fake tool registered → visible; malformed-line/unknown-method tolerance; oversized-frame rejection) — renamed 2026-07-24 from `stdio-server.test.ts`; `src/gateway-mcp/registry.test.ts` (duplicate-name rejection) |
| Doctor detects each seeded fault (wrong engine version, missing bwrap, rogue settings, bad socket perms, torn journal) with a correct repair plan | `doctor.fault-matrix.test` | `src/doctor/doctor.fault-matrix.test.ts` (all 5 named fixtures, each asserting `passed:false` + a correct `repairStep` — the socket-perms case now binds a REAL UDS socket at `resolveSupervisorSocketPath`'s exact path and runs it through `buildDefaultDoctorChecks`'s own production wiring); per-check unit suites under `src/doctor/checks/*.test.ts` and `src/doctor/run-doctor.test.ts` cover pass/fail branches for every check |
| Secret value in argv rejected with guidance, never echoed in output or evidence | `secret-ref.rejection.test` | `src/argv/secret-ref.rejection.test.ts` (renamed 2026-07-24 from `secret-reference.test.ts`), `src/argv/secret-reference.property.test.ts` (fast-check over random argv permutations — known-prefix, JWT, and high-entropy shapes all rejected, never echoed); `src/commands/cli.commands.schema.test.ts`'s `connection-add` case exercises the parser boundary end-to-end |
| Approval token verifies once, expires, and binds to the exact digest it was minted against | `approval-token.property.test` | `src/approval/token.test.ts` (single-use, expiry, digest/subject-kind binding, no-double-journal-on-repeat-mint, tampered-signature, cross-minter-key rejection); `src/approval/approval-token.property.test.ts` (renamed 2026-07-24 from `token.property.test.ts`; fast-check: single-use / digest-binding / expiry hold under randomized `(subjectKind, digest)` sequences) |
| `evidence <change-set-id>` returns every journaled `EvidenceRecord` for that ChangeSet, ... and an empty-but-valid report before any exist | `evidence.query.test` | `src/evidence/evidence.query.test.ts` (renamed 2026-07-24 from `query.test.ts`; empty-but-valid report; multi-record, per-ChangeSet-scoped retrieval; ordering; ignores a non-`evidence_pointer` entry under a permissive fake) |
| Help text and every `--json` output schema are snapshot-stable | `cli.snapshots.test` | `src/commands/cli.snapshots.test.ts` (top-level + per-topic help snapshots, `NOT_IMPLEMENTED` shape snapshot, `gateway mcp` tool-listing shape snapshots, byte-comparison of the exact `engineering-orchestrator gateway mcp` invocation against `package.json`'s own `bin` entry) |

## Gate results (this build)

- `npx tsc -b packages/cli` — clean (see `gate-results.txt`).
- `npx vitest run packages/cli --coverage.enabled=false` — **196 tests / 29 files, all green**.
- `npx eslint packages/cli` — clean, zero warnings/errors.
- Coverage, scoped to `packages/cli/src/**/*.ts` (excluding `*.test.ts`/`dist`): **statements 89.81%, branches 83.20%, functions 89.54%, lines 90.98%** — all four ≥ the 80% ground-rule floor.

## Adversarial-review fixes (2026-07-24)

An independent adversarial validation pass found the crypto/argv/parser core sound but flagged the
doctor's host self-tests as largely vacuous in the shipped binary, plus a few robustness/traceability
gaps. All fixes below are TDD (failing-first regression test, then the fix), scoped to `packages/cli/`
only.

| # | Finding | Fix | Regression test |
|---|---|---|---|
| 1 (HIGH) | Hermeticity self-test passed vacuously: `ProcessProbeFn` took no `cwd`/`env`, so the planted rogue `CLAUDE.md` and isolated `CLAUDE_CONFIG_DIR` were never actually in scope when `claude` ran — `rogueMarkerLeaked` was structurally always `false`. | `ProcessProbeFn` (`process-probe.ts`) now carries `cwd`/`env` (env REPLACES, never merges); `createRealProcessProbe` passes both to `child_process.spawn`; `createRealHermeticitySelftestProbe` (`hermeticity-selftest.ts`) now runs `claude` with `cwd: scratchDir` and an allowlisted `env` (`PATH`, isolated `HOME`, `CLAUDE_CONFIG_DIR`) — mirroring `docs/engine-baseline.md` §2's own probe methodology. | `process-probe.test.ts` (cwd/env honored against a real `node` child); `hermeticity-selftest.test.ts`'s "adversarial-review regression guard" case (asserts the exact `cwd`/`env` shape reaching the probe) |
| 2 (MEDIUM-HIGH) | The supervisor's UDS control socket (0600-in-0700 spec) was never fed to any doctor check; the fault-matrix "bad socket perms" case checked an unrelated fake directory. | `run-doctor.ts` now computes `resolveSupervisorSocketPath` and feeds it (`kind:"file"`, `SUPERVISOR_SOCKET_MODE` = 0600) into the `xdg.permissions` check's path list; `RunDoctorOptions` gained an injectable `xdgEnv` override for determinism. | `run-doctor.test.ts` (binds a REAL UDS socket at the real resolved path, mis-chmods it, proves the production wiring catches it, and a correctly-permissioned socket passes); `doctor.fault-matrix.test.ts`'s socket-perms case rewritten the same way |
| 3 (MEDIUM) | `sandbox-selftest.ts` treated ANY non-zero exit from the confinement probe as "write correctly denied" — but `bwrap` also exits non-zero on a SETUP failure (unprivileged userns disabled), before ever attempting the write, which was reported as a false PASS. | Added `isSetupFailure()`, keyed on `bwrap`'s own `"bwrap:"`-prefixed stderr diagnostics (never emitted by the inner confined command) — a setup failure now returns a distinct, failing "UNVERIFIED" finding with a repair step (`kernel.unprivileged_userns_clone=1`), never a false PASS. | `sandbox-selftest.test.ts`'s new setup-failure-host case, plus a companion case proving a genuine (non-bwrap-prefixed) write-denial still passes |
| 4 (MEDIUM) | `gateway mcp`'s stdio server buffered input with a bare `buffer += chunk`, no cap — an unbounded, newline-less frame was an OOM DoS vector. | `stdio-server.ts` now reuses `@eo/supervisor`'s own `createLineFramer`/`LineTooLongError` (the same `MAX_LINE_BYTES` cap the UDS client/server already use) instead of a second, uncapped implementation; an oversized frame gets a JSON-RPC error response and the server stops. | `gateway-mcp.boot.test.ts`'s oversized-frame case |
| 5 (MEDIUM) | `bin.ts` built `CliDependencies` with no `resolveAuthState`, so `doctor`'s auth check always fell back to `run-doctor.ts`'s constant `"missing"` — always FAILING even on an authenticated host. | Added `createRealAuthStateResolver` (`auth-probe.ts`) — checks `CLAUDE_CODE_OAUTH_TOKEN`, then the mode-checked `~/.claude/.eo-oauth-token` handoff file, then mode-checked/JSON-parseable `~/.claude/.credentials.json`, per `docs/engine-baseline.md` §1 — never resolving/logging the secret content itself. Extracted `bootstrap.ts`'s `buildRealCliDependencies` (now the actually-tested real wiring `bin.ts` calls) which wires this resolver by default, scoped to the same `HOME` as the rest of the dependency bag. | `auth-probe.test.ts` (all classification branches, real filesystem fixtures); `bootstrap.test.ts` (the DEFAULT wiring's "missing" → "valid" transition once a real credential file is planted under the same `HOME` — not just an injected fake asserting so) |

### Lower-priority items — decided or fixed

- **#6 (approval-token cross-process durability):** **decided against implementing, documented here.**
  The primitive's single-use tracking is in-memory (`#pendingByKey`/`#pendingById`), scoped to one
  `ApprovalTokenMinter` instance. A durable *consumption ledger* alone (e.g. `@eo/journal`'s
  `IdempotencyRegistry`, keyed by `tokenId`) would NOT by itself make this usable across genuinely
  separate OS processes, because `verify()` also requires the SAME HMAC `secretKey` the minting
  process used — and no phase has assigned an owner for cross-process secret-key distribution.
  Implementing only the ledger half would be a partial, misleading fix. **Decision:** keep the
  primitive in-process for this phase, matching its own scope text ("this phase supplies only the
  generic mint/verify/expire primitive"); the `approval_token_mint` journal entry already gives
  11/12/auditors a durable audit record that a mint occurred, independent of live in-memory
  enforcement. **Recommendation for 11/12:** either (a) host this primitive inside one long-lived
  process per project (e.g. behind the supervisor/gateway) so "cross-process" collapses to
  "cross-MCP-tool-call within one process" — trivially satisfied today — or (b) if genuinely
  multi-process, pair a durable consumption ledger with a shared secret persisted under 04/05's XDG
  state root. Neither is implemented here; this is an explicit, reasoned scope decision, not an
  oversight.
- **#4b (UDS client per-request timeout):** **fixed.** `UdsClientOptions.requestTimeoutMs` (default
  30s) now bounds `request()` itself, not just `connect()` — a server that accepts, handshakes, and
  then never answers no longer hangs the caller forever. See `client.test.ts`'s new "per-request
  timeout" suite (a raw `net.Server` that acks the handshake and then silently swallows every
  request).
- **#7 (test-file naming / published-schema validation / stale comment):** **fixed.** Five test files
  renamed to their exact exit-criterion suite names (table above); `cli.commands.schema.test.ts` now
  additionally validates `status`/`cancel --json` output against 05's real, published
  `RunStatusResultSchema`/`RunCancelResultSchema` (not just snapshot-stable) — `evidence`/`doctor`/
  `NOT_IMPLEMENTED` have no published schema anywhere in `@eo/contracts`/`@eo/supervisor`, so snapshot
  stability remains the correct mechanism for those three, noted explicitly in that file's own doc
  comment. The stale comment at the old `secret-reference.ts:70-72` (claiming `parse-command.ts` used
  `isSecretShapedValue`) is corrected — the parser calls `parseSecretReference` directly; the
  classifier is test-only.

## Deviations / carry-forward items for the orchestrator

1. **Repo-wide `npx tsc -b` does not pass**, but the failure is entirely inside `packages/gateway`
   (`src/mcp/native-tools/*.ts`, `src/mcp/**`, `src/transport/**`, etc.) — files this session never
   touched. `git status`/`git diff --stat packages/gateway` at the start of this session already showed
   uncommitted, in-progress work there (untracked `src/mcp/`, `src/transport/`, `src/secrets/`, ... plus
   modified `package.json`/`index.ts`/`tsconfig.json`) predating this phase's work. `npx tsc -b packages/cli`
   in isolation is clean. This is a pre-existing/parallel-work state for the orchestrator to reconcile, not
   a phase-09 defect.
2. **Project-hash derivation has no owner in the roadmap yet.** `@eo/journal`'s own layout module says so
   explicitly ("this package does not define how a project hash is derived"). `packages/cli/src/project-hash.ts`
   provides a provisional `sha256(cwd).slice(0,16)` derivation purely so `doctor`/`evidence`/the XDG-permission
   check have a concrete path to operate against in `bin.ts`. Replace this the moment a real phase claims
   ownership of project-hash derivation.
3. **`gateway mcp`'s MCP transport is a minimal, self-built JSON-RPC/ndjson subset** (`src/gateway-mcp/protocol.ts`,
   `stdio-server.ts`) rather than a dependency on `@modelcontextprotocol/sdk`. The SDK package is already present
   in the repo's lockfile/`node_modules` (transitive dependency of `@anthropic-ai/claude-agent-sdk`, used by
   `packages/engine-claude`), but is not declared as a direct dependency anywhere and adding it to
   `packages/cli/package.json` would need a real `npm install` to update the root `package-lock.json` — a
   root-config file this phase's hard constraints forbid editing. The implemented subset (`initialize`,
   `tools/list`, ndjson framing, JSON-RPC 2.0 envelopes) satisfies this phase's own exit criterion (boot +
   tool-listing over stdio to a stub client) without that dependency edge. **Recommendation for the
   orchestrator:** if 16/10/23 need the real SDK's wire-compatibility guarantees beyond `tools/list`
   (e.g. `tools/call`, resource/prompt primitives), add `@modelcontextprotocol/sdk` to `packages/cli/package.json`
   and run `npm install` at the root in a coordinated change — this phase's own registry/boot abstractions
   (`McpToolRegistry`, `startGatewayMcpServer`) are structured so that swap only touches `stdio-server.ts`.
4. **How 16's tool families physically reach this phase's registry is unresolved** — flagged identically in
   `roadmap/09-cli-and-doctor.md` §Risks itself ("This phase's own exit criteria are satisfiable against a
   stub/fake registry and don't require resolving this; whoever lands 16, or 23's final wiring pass, must
   settle the actual composition point"). `bin.ts` currently constructs a fresh, empty `McpToolRegistry` at
   `gateway mcp` boot time; 16/11/12 registering into that exact instance (vs. a shared composition root) is
   the open wiring question this phase's text already names, not a phase-09 gap.
5. **`resume <run-id>` is a `NOT_IMPLEMENTED` stub**, per the phase's own text ("this phase defines only the
   command shape and UDS plumbing... full run/session semantics land in 06 and 13"). 05's own
   `SUPERVISOR_OPERATIONS` list has no `run.resume`-shaped op to wire against yet, so the command parses
   correctly (`src/argv/parse-command.test.ts`) but dispatches to the typed `NOT_IMPLEMENTED` shape
   (`src/commands/dispatch.test.ts`) until 06/13 land a real op.
6. **`status [run-id]` with no `run-id`** (i.e. "list every run") is also `NOT_IMPLEMENTED` — 05's router has
   no `registry.runs.list` operation (only `run.status`/`run.cancel` and the `registry.changeSets/workUnits/
   workers/artifactIndex.*` reads), so this shape has nothing to wire against yet either. `status <run-id>`
   itself (with or without `--watch`) is fully wired.
7. **Coverage is scoped via `--coverage.include='packages/cli/src/**/*.ts'` on the CLI invocation**, not the
   root `vitest.config.ts`'s repo-wide include glob — running `vitest run packages/cli --coverage.enabled=true`
   with the root config's own include (which spans every package under `packages/*/src`) reports the whole
   monorepo's aggregate coverage (~11%) rather than this package's own, because v8's coverage provider
   instruments every file matching the configured include glob regardless of which project's tests executed.
   This is a measurement artifact of the shared root config (which this phase's hard constraints forbid
   editing), not a coverage gap in `packages/cli` itself — the scoped invocation in `gate-results.txt` is the
   correct reading.
8. **`bin.ts` and `project-hash.ts` are intentionally thin/low-coverage-by-design.** `bin.ts` is a ~40-line
   process/stdio shim with no branching logic of its own (every real branch was extracted into
   `cli-entry.ts`'s `runCliEntry`, which IS unit-tested — see `src/cli-entry.test.ts`); `project-hash.ts` is a
   single deterministic hash call. Neither pulls the package's aggregate coverage below the 80% floor (final
   scoped numbers: 88.75% / 82.27% / 88.35% / 90.03%), but both show as 0% individually in the per-file table
   in `gate-results.txt` — noted here so that's read as a deliberate architectural choice, not an oversight.

## What later phases consume from here (as directed by the roadmap)

- **10** (plugin/installer): the exact `["engineering-orchestrator", ["gateway", "mcp"]]` invocation is
  byte-tested against `package.json`'s own `bin` entry (`src/commands/cli.snapshots.test.ts`); `install`/
  `upgrade`/`uninstall` are `NOT_IMPLEMENTED` stubs ready for 10 to replace.
- **11** (intake/contract/approval): `ApprovalTokenMinter`/`runApprovalFlow` (`src/approval/`) are the generic
  primitive 11 binds to its own envelope-hash subject; `run`'s pre-dispatch sequence is a `NOT_IMPLEMENTED`
  stub for 11 to replace.
- **12** (stack detection/quarantine): the same `ApprovalTokenMinter` binds to 12's capability-digest subject;
  `trust review|approve|revoke` are `NOT_IMPLEMENTED` stubs for 12 to replace.
- **16/18/19/20** (gateway/connectors): `connection add|list|doctor|capabilities` are `NOT_IMPLEMENTED` stubs;
  `McpToolRegistry` is the extensible registry 16's native tool families register into.
- **22** (learning): `learn list|approve|reject|rollback` are `NOT_IMPLEMENTED` stubs.
- **23** (release hardening): re-verifies zero `NOT_IMPLEMENTED` remains anywhere across the whole CLI surface.
