# `@eo/engine-core`

Phase 03 deliverable — roadmap/03-envelope-compiler-engine-adapter.md, work items 1–4. This
package owns two things:

1. The `EngineAdapter` contract (`spawn`, `resume`, `cancel`, `capabilities()`, the typed
   `EngineEvent` stream, `WorkerHandle`, `SessionRef`, `AdjudicationCallback`) — a frozen
   interface. The only formal consumer that depends on this phase (`P03 --> P05 & P06` in
   `roadmap/README.md`'s dependency graph) is phase 06 (`packages/engine-claude`, the real
   SDK-backed implementation); phase 03's own tests exercise a minimal in-package
   `StubEngineAdapter` only to prove the contract is satisfiable, never the scriptable fake
   engine phases 05/06 actually import (that lives in `packages/testkit`, roadmap/03 work
   item 5, a different worker's deliverable).
2. `compileEnvelope(envelope: AuthorizationEnvelope) => CompiledWorkerProfile` — a pure
   function producing a permission profile, a sandbox profile, and their two serializations
   (`WorkerSettingsJson`, the `--settings <file>` shape; `WorkerSdkOptions`, the Agent SDK
   `query()` options subset), plus the golden settings artifacts for three canonical
   envelopes.

Everything here is engine-touching and therefore cites `docs/engine-baseline.md` (phase 00's
verified-fact record, pinned range `2.1.207`–`2.1.210`) — never memory — per
`roadmap/README.md`'s engine-fact-drift ground rule.

## Adapter-responsibility doc (roadmap/03 deliverable 4)

### Journal-entry lifecycle mapping

This phase does not write to the journal — phase 04 (`@eo/journal`) owns the journal
mechanics, and phases 05/06 own actually calling it. This package only names which
`JournalEntryType` member (interface-ledger Gap 5, owned by `@eo/contracts`) is due at each
`EngineAdapter` lifecycle point, so a future caller knows what to write and when:

| Lifecycle point | `JournalEntryType` member | When |
| --- | --- | --- |
| `EngineAdapter.spawn()`/`resume()` returns | `session_assignment` | Once, synchronously — `WorkerHandle.sessionRef` is available immediately on return (before any `EngineEvent` is consumed), matching adaptation §4.5's "supervisor-chosen via `--session-id <uuid>`, so the journal knows it before the process starts." |
| Every `AdjudicationCallback` invocation | `adjudication_decision` | Per tool call — each `allow`/`deny` decision the callback returns should be journaled by whoever supplies the callback (05's stub policy, 06's real journal-first policy), pre-execution, matching adaptation §4.3: "the supervisor adjudicates every tool call in-process against the envelope and journals the decision before returning it." |

No other `JournalEntryType` member is this package's concern.

### Seam decision: control-repo/journal deny-path literals

`compileEnvelope`'s mandatory sandbox `denyRead`/permission `Read(...)` denies for the
control repo and journal (adaptation §4.2, §5.1: "denyRead control repo, journal, `~/.ssh`,
`~/.aws`") need *some* concrete path. Phase 03 depends only on phase 00 + phase 02
(`roadmap/README.md`'s dependency graph) and must **not** import `@eo/journal` (phase 04) —
interface-ledger Gap 14 assigns phase 04 ownership of the canonical
`$XDG_STATE_HOME`/`$XDG_CACHE_HOME` runtime-root constants, nested further under a
per-project hash (e.g. `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/git-control/`).

This package's own literals (`src/compiler/xdg-default-paths.ts`) are therefore **XDG-DEFAULT
fallbacks**, deliberately simpler than Gap 14's eventual pinned convention — `~`-anchored, no
`$XDG_STATE_HOME`/`$XDG_CACHE_HOME` environment-variable resolution, no per-project-hash
nesting:

- `~/.local/state/engineering-orchestrator/**` — state root, assumed to hold journal +
  control data (mirrors Gap 14's state-root half).
- `~/.cache/engineering-orchestrator/**` — cache root, assumed to hold the control clone
  (mirrors Gap 14's cache-root half).

**Obligation on 05/06:** once both `@eo/engine-core` and `@eo/journal` are linked by a
downstream phase, 05/06 must add a consistency test proving these defaults never silently
diverge from `@eo/journal`'s real runtime-resolved roots (e.g. a non-default
`$XDG_STATE_HOME` must not open a gap between what this compiler denies and where the
journal actually lives). This package cannot add that test itself without creating the
forbidden `@eo/engine-core -> @eo/journal` dependency edge.

### Placeholder-token convention: `sandbox.filesystem.allowWrite`

`compileEnvelope`'s signature is `(envelope: AuthorizationEnvelope) => CompiledWorkerProfile`
only — no worktree/tmp-directory parameter — so it cannot know either absolute path at
compile time (the worktree is chosen by phase 07's control-repo/worktree machinery, a later
lifecycle stage this phase never sees). `emitSandboxProfile` therefore emits two symbolic
literal tokens in `filesystem.allowWrite`:

- `<worktree>`
- `<worker-tmp>`

These are this compiler's own documented decision (not pinned by any cited source
material). The real SDK-backed adapter (phase 06) is expected to substitute the actual
absolute paths at spawn time, before ever calling into the engine.

### Placeholder value: `WorkerSdkOptions.mcpServers`

Similarly, `toWorkerSdkOptions` emits `mcpServers: { [GATEWAY_MCP_SERVER_NAME]: {} }` — an
empty placeholder object under the gateway's key. This pure compiler has no access to a
live, wired SDK MCP server instance (`createSdkMcpServer(...)`, adaptation §5.3); registering
the actual gateway tool handlers is phase 16's job, and wiring that live object into the SDK
`query()` call is phase 06's job. This compiler's job stops at the *decision* that exactly
one server, under this one key, is registered — `strictMcpConfig: true` (also emitted here)
is what turns that decision into "single-server exposure," per roadmap/03's own footgun
bullet, rather than ever denying `mcp__*` broadly.

### Deviation from adaptation Appendix B's illustrative sketch

Appendix B's worker-permission-profile sketch additionally shows an unconditional
`"Read", "Grep", "Glob"` allow and an `Edit(//abs/path/worktree/.git/**)` deny. This
compiler emits **neither** — roadmap/03's own binding work-item-2 text is stricter than that
older illustrative sketch: "asserting `permissions.allow` contains only the four
doc-confirmed `Bash(...)` literals, the owned-path `Edit`/`Write` entries, and
`mcp__${GATEWAY_MCP_SERVER_NAME}__*`" (the literal word "only"). `emitPermissionProfile`'s own
test suite (`permission-profile.test.ts`) asserts this containment directly. Similarly, this
compiler's sandbox profile omits Appendix B's `credentials.files` sub-block (deny-listing
`~/.ssh`/`~/.aws/credentials` file paths directly) — redundant with `filesystem.denyRead` +
the permission profile's own `Read(~/.ssh/**)`/`Read(~/.aws/**)` denies, and not named by
this phase's binding work-item text.

### Security-fix round (2026-07-18): owned-path worktree anchoring + Edit/Write deny backstops

An adversarial validation pass reproduced a CRITICAL confinement-escape defect in
`emitPermissionProfile` (`src/compiler/permission-profile.ts`): owned-path `Edit`/`Write`
allow entries were emitted as `Edit(//${path}/**)` from **raw, unvalidated**
`envelope.ownedPaths` entries, with **no worktree anchoring** at all. Since `//` is the
FILESYSTEM-ROOT anchor (adaptation §4.1: "`//abs/path/**` (filesystem root)"; Appendix B's
own sketch: `Edit(//abs/path/worktree/**)` — `//` followed by an ABSOLUTE path, not a bare
relative one), an innocuous-looking relative owned path like `"etc/cron.d"` compiled to
`Edit(//etc/cron.d/**)`, which under §4.1's own stated semantics IS `/etc/cron.d/**` — an
absolute, system-directory grant. `"~/.ssh"`, `"**"`, `".."`-bearing paths all escaped the
same way. Unlike `sandbox-profile.ts`'s `filesystem.allowWrite`, which already used a
`<worktree>` placeholder token for phase 06 to substitute, the permission layer had no
placeholder at all — so phase 06 had nothing to rewrite, AND ordinary relative owned paths
would fail to match on the real engine (a fail-closed break in the opposite direction). No
`Edit`/`Write` deny backstop existed either (only `Read(...)` denies for the sensitive
roots; Appendix B's own `Edit(//abs/path/worktree/.git/**)` deny had been dropped).

**Fix, three parts:**

1. **Validation** (`src/compiler/owned-path.ts`, `validateOwnedPath`): every
   `envelope.ownedPaths` entry is now validated — REJECTED (throws
   `EnvelopeCompilationError`, `src/compiler/compiler-error.ts`) if, after trim, it is empty,
   absolute (leading `/`), home-anchored (leading `~`), carries a `..` segment, or carries a
   glob metacharacter (`*?[]{}\`). Legit owned paths are worktree-relative literal directory
   names (`src`, `packages/app/src`).
2. **Shared worktree-anchor token** (`src/compiler/worktree-placeholders.ts`): the
   `WORKTREE_WRITE_PLACEHOLDER`/`WORKER_TMP_WRITE_PLACEHOLDER` constants, previously defined
   only in `sandbox-profile.ts`, are now defined in exactly one shared module both
   `permission-profile.ts` and `sandbox-profile.ts` import (`sandbox-profile.ts` re-exports
   both for existing consumers). Every validated owned path is now emitted as
   `Edit(//<worktree>/${relpath}/**)` / `Write(//<worktree>/${relpath}/**)` — the SAME
   placeholder convention the sandbox layer already used, giving phase 06 one consistent
   `<worktree>` token to substitute with the real absolute worktree path everywhere it
   appears.
3. **Edit/Write deny backstops** (defense-in-depth, deny-wins): `permission-profile.ts`'s
   `MANDATORY_PATH_DENY` now mirrors every sensitive-root `Read(...)` deny with `Edit(...)`/
   `Write(...)` siblings (control-repo state+cache root, `~/.ssh`, `~/.aws`), plus a new
   `Edit(//<worktree>/.git/**)` / `Write(//<worktree>/.git/**)` pair protecting the worktree's
   own git internals — restoring Appendix B's dropped `.git` deny.

Two new footgun invariants (`src/footguns/invariants.ts`) guard this structurally:
`assertAllOwnedPathAllowRulesAreWorktreeScoped` (every `Edit`/`Write` allow rule must carry
the `//<worktree>/` prefix) and `assertEditWriteDenyBackstopPresent` (the backstop denies
above must always be present) — both wired into `assertNoFootguns` and covered by two new
mutation seeds (4, 5) in `docs/evidence/phase-03/wi4-mutation-report.txt`.

The property suite's former "no allow outside the envelope" test (`footguns/property.test.ts`)
was **tautological** (it re-derived the exact string the compiler itself emitted and
asserted equality against it — provably unable to detect any confinement escape). It is now
a genuinely SEMANTIC property: `src/footguns/confinement-check.ts` implements a minimal,
INDEPENDENT anchored-glob matcher (deliberately not the compiler's own emission code, and
deliberately not `@eo/testkit`'s fake-engine matcher — this package must not depend on
`@eo/testkit`, see `compiler/envelope-fixture.ts`'s own seam-decision doc comment) that
evaluates the compiled profile against concrete target paths OUTSIDE every declared owned
path (`../etc/passwd`, `/etc/passwd`, `~/.ssh/id_rsa`, `.git/config`, an unrelated sentinel
path) and asserts every one is denied, plus a positive counterpart proving declared-owned
targets are allowed. `footguns/envelope-arbitrary.ts` now generates `ownedPaths`/
`networkDestinations` in two separate buckets — well-formed (used by the general property
suite, which must never throw unexpectedly) and malformed (used by two new dedicated
"compileEnvelope always rejects this" properties, ≥10k/≥2k cases respectively).

`@eo/testkit`'s fake engine (`packages/testkit/src/fake-engine/path-matching.ts`) was
adjusted to match: its `//` anchor now resolves the SAME `WORKTREE_WRITE_PLACEHOLDER` token
this package emits (stripping it specifically, not any arbitrary base) rather than treating
`//` itself as a synonym for "worktree-relative" — the prior doc comment's "`//` =
worktree-relative" wording was itself part of the confusion this defect exploited, since it
silently redefined `//` as the OPPOSITE partition from the real engine's filesystem-root
anchor.

**ENGINE-FACT-DRIFT gap (mandatory per `CLAUDE.md`'s engine-fact-drift ground rule;
interface-ledger Gap-12 precedent):** `docs/engine-baseline.md` §3 (Permission probes)
records **no path-anchor probe at all** — every recorded probe there is Bash-prefix/colon-
spacing behavior; the "`Edit` outside the allowed path denied" probe confirms only that
*some* out-of-scope path is denied, not the specific `//` vs `~/` vs bare-`/` matching
semantics. This compiler now COMMITS to the `//<worktree>/…/**` worktree-anchored form as
its intended confinement mechanism (worktree-relative owned paths, filesystem-root-anchored
once phase 06 substitutes the real absolute worktree path), but the EXACT real-engine
matching behavior of that substituted form — whether `//` + an absolute path behaves exactly
as adaptation §4.1's doc text states, whether a doubled leading slash after substitution
ever arises, how this interacts with WSL2 path forms — is UNPROBED. This is a phase-00-style
probe still OWED to phase 06's `@live` conformance suite, exactly as Gap 12 handled Bash
colon-spacing (a syntax question resolved by a dedicated probe before the compiler was
allowed to generalize past it). This gap is flagged here for the orchestrator to carry to
`docs/interface-ledger.md` at the next reconcile — this worker does not edit the ledger
directly.

### `networkDestinations` validation (MINOR 4, same security-fix round)

`sandbox-profile.ts`'s `network.allowedDomains` previously copied `envelope.networkDestinations`
verbatim — `*`, `**`, `0.0.0.0/0`, `http://evil`, `evil.com:443` all passed through
unfiltered. `src/compiler/network-destination.ts`'s `validateNetworkDestination` now rejects
(throws `EnvelopeCompilationError`) any entry that is empty, exactly `*`/`**`, carries a URI
scheme (`://`), a path/CIDR suffix (`/`), or a port (`:`). These are the settled rejection
criteria for this fix round; they do not assert a full domain-name grammar (a bare `.` is
not separately rejected) — flagged here as a known scoping gap, not silently expanded past
what was specified.

### `AdjudicationCallback` mirrors the documented SDK shape, not the CLI flag

`AdjudicationCallback` (`src/adapter/adjudication.ts`) deliberately mirrors the **documented**
Agent SDK `canUseTool` callback shape (adaptation §4.3, §5.3) — `(toolName, toolInput,
context) => Promise<{behavior: "allow", updatedInput} | {behavior: "deny", message,
interrupt?}>` — never the undocumented CLI flag `--permission-prompt-tool` (roadmap/03
§Risks, "§10 risk #2"). Phase 06 must build its real wiring against the SDK shape, not the
CLI flag.

### Footgun/property/mutation suites (work item 4)

`src/footguns/` holds the invariant checkers (`invariants.ts`, exported and reusable by 06's
own conformance suite), the independent semantic confinement matcher
(`confinement-check.ts` — added in the 2026-07-18 security-fix round, see above), the
two-bucket arbitrary generator (`envelope-arbitrary.ts`), and five test files:

- `mcp-deny.test.ts` — never a blanket `mcp__*` deny.
- `anchor-forms.test.ts` — `//` vs `~/` anchor forms never collide or shadow; also asserts
  `compileEnvelope` rejects a `~/`-prefixed owned path outright (2026-07-18: this file
  previously asserted the OPPOSITE — that such a path compiled to a valid-looking allow
  rule — which was itself the tautological-test defect MAJOR 3 flagged).
- `smuggling.test.ts` — compound-command/process-wrapper smuggling never widens the compiled
  Bash allow-list (docs/engine-baseline.md §3's recorded verdicts).
- `property.test.ts` — the roadmap's ≥10k-case fast-check properties (no allow outside the
  envelope — now SEMANTIC via `confinement-check.ts`, not tautological; mandatory denies +
  Edit/Write backstop survive any envelope; no blanket `mcp__*` deny ever; every owned-path
  allow rule is worktree-scoped) plus two 2026-07-18 additions (malformed `ownedPaths`/
  `networkDestinations` are always rejected).
- `mutation.test.ts` — five seeded broken-compiler variants (blanket `mcp__*` deny; dropped
  mandatory `denyRead` paths; space-before-colon Bash literal; raw unanchored owned-path
  allow rule; dropped Edit/Write deny backstop — the last two added 2026-07-18), each proven
  caught. Full write-up: `docs/evidence/phase-03/wi4-mutation-report.txt`.

## Golden settings artifacts

`goldens/*.json` (committed) are `compileEnvelope`'s byte-stable output for three canonical
envelopes — `read-only`, `standard-implementation`, `network-granted` — each serialized twice
(`.settings.json`, `.sdk-options.json`). Regenerate with `npm run build:goldens` from this
package (`scripts/write-goldens.ts`, mirroring `packages/contracts/scripts/build-schemas.ts`'s
own documented determinism convention: `JSON.stringify(value, null, 2)` + one trailing
newline, fixed key order). `goldens/` is excluded from the repo's prettier gate
(`.prettierignore`), matching `packages/contracts/schemas/`'s precedent — this raw
`JSON.stringify` output is deliberately not prettier's own JSON style.

**Regenerated 2026-07-18** (security-fix round): the CRITICAL 1 fix changes every owned-path
`Edit`/`Write` allow entry's spelling (now `//<worktree>`-anchored — `standard-implementation`/
`network-granted` only, since `read-only` declares no owned paths) and adds ten Edit/Write
deny-backstop entries (eight sensitive-root Edit/Write siblings + the `.git` Edit/Write pair)
to EVERY canonical envelope's `deny` array, including `read-only`'s — the backstop is
mandatory regardless of `ownedPaths`. Regenerated via `npm run build:goldens` and
re-verified byte-stable across two consecutive generations before being committed.

## `GATEWAY_MCP_SERVER_NAME` (interface-ledger Gap 11)

Every reference to the gateway's MCP server name in this package derives the literal from
`GATEWAY_MCP_SERVER_NAME` (imported from `@eo/contracts`) — never hand-typed. This is
enforced repo-wide by `packages/contracts/src/gateway/server-name.test.ts`'s sole-definition-
site scanner, which this package's `src/` tree (including comments and test fixtures) must
stay clean against.
