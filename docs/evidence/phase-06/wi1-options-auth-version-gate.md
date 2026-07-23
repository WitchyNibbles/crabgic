# Phase 06, work item 1 — worker-profile assembler, auth, version gate (W1)

Evidence trail for this worker's slice of roadmap/06-claude-engine-adapter.md
work item 1: `packages/engine-claude/src/{gateway-server-config,model-routing,
auth,version-gate,options-assembler}.ts` + their `.test.ts` siblings +
`gateway-name-reference.test.ts` (exit-criterion name) + `goldens/*.sdk-call.json`.
Test-driven throughout: every implementation module below was written only
after its sibling `.test.ts` file existed and was run RED against the
missing module.

## RED captures

### `model-routing.test.ts`

Written and implemented together as the first (simplest) module; RED was
not captured in isolation before implementation (see **Deviations** below).
`resolveWorkerModel`/`DEFAULT_WORKER_MODEL` are trivial enough that their
own suite's assertions cannot fail "harder" than the module not existing —
the same reasoning phase-02's evidence record applies to its own
`connector-error.ts` RED capture.

### `auth.test.ts`, `gateway-server-config.test.ts`, `version-gate.test.ts`

Command: `cd /home/eimi/projects/crabgic && npx vitest run --project @eo/engine-claude --coverage.enabled=false`

```
 FAIL  |@eo/engine-claude| src/auth.test.ts [ packages/engine-claude/src/auth.test.ts ]
Error: Cannot find module './auth.js' imported from /home/eimi/projects/crabgic/packages/engine-claude/src/auth.test.ts
 ❯ src/auth.test.ts:6:1
      4| import { join } from "node:path";
      5| import { afterEach, beforeEach, describe, expect, it } from "vitest";
      6| import { WorkerAuthError, buildWorkerEnv, provisionWorkerAuth } from "…
       | ^

 FAIL  |@eo/engine-claude| src/gateway-server-config.test.ts [ packages/engine-claude/src/gateway-server-config.test.ts ]
Error: Cannot find module './gateway-server-config.js' imported from /home/eimi/projects/crabgic/packages/engine-claude/src/gateway-server-config.test.ts
 ❯ src/gateway-server-config.test.ts:3:1
      1| import { describe, expect, it } from "vitest";
      2| import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
      3| import { buildGatewayMcpServers } from "./gateway-server-config.js";
       | ^

 FAIL  |@eo/engine-claude| src/version-gate.test.ts [ packages/engine-claude/src/version-gate.test.ts ]
Error: Cannot find module './version-gate.js' imported from /home/eimi/projects/crabgic/packages/engine-claude/src/version-gate.test.ts
 ❯ src/version-gate.test.ts:5:1
      3| import { fileURLToPath } from "node:url";
      4| import { describe, expect, it } from "vitest";
      5| import {
       | ^
      6|   ACCEPTED_ENGINE_VERSION_RANGE,
      7|   ACCEPTED_SDK_VERSION_RANGE,

 Test Files  3 failed | 1 passed (4)
      Tests  5 passed (5)
```

(The "1 passed / 5 tests" is `model-routing.test.ts`, already implemented at
this point.)

### `options-assembler.test.ts`, `gateway-name-reference.test.ts`

Same command, run once `auth.ts`/`gateway-server-config.ts`/`version-gate.ts`
existed but `options-assembler.ts` did not yet:

```
 FAIL  |@eo/engine-claude| src/gateway-name-reference.test.ts [ packages/engine-claude/src/gateway-name-reference.test.ts ]
Error: Cannot find module './auth.js' imported from /home/eimi/projects/crabgic/packages/engine-claude/src/gateway-name-reference.test.ts
 ❯ src/gateway-name-reference.test.ts:8:1
      6| import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
      7| import { CANONICAL_ENVELOPE_CASES, compileEnvelope } from "@eo/engine-…
      8| import { buildWorkerEnv } from "./auth.js";
       | ^
      9| import { assembleWorkerOptions } from "./options-assembler.js";

 FAIL  |@eo/engine-claude| src/options-assembler.test.ts [ packages/engine-claude/src/options-assembler.test.ts ]
Error: Cannot find module './auth.js' imported from /home/eimi/projects/crabgic/packages/engine-claude/src/options-assembler.test.ts
 ❯ src/options-assembler.test.ts:13:1
     11|   type CompiledWorkerProfile,
     12| } from "@eo/engine-core";
     13| import { buildWorkerEnv } from "./auth.js";
       | ^
```

(Both files import `./auth.js`, which resolves the module-not-found error
onto that import line before ever reaching `./options-assembler.js`'s own
missing-module error — expected, since ESM resolves imports top-to-bottom.)

### Golden-fixture RED (roadmap/06 work item 1's own sanctioned form: "diff

against a golden SDK-call fixture that does not exist yet")

Once `options-assembler.ts` was implemented and `tsc -b` was clean, the
golden-comparison sub-tests failed on the missing committed fixture files
(the goldens did not exist yet — exactly the roadmap's own described RED):

```
 FAIL  |@eo/engine-claude| src/options-assembler.test.ts > golden SDK-call fixtures — byte-stability against committed goldens > read-only.sdk-call.json is byte-identical to the committed golden
Error: ENOENT: no such file or directory, open '/home/eimi/projects/crabgic/packages/engine-claude/goldens/read-only.sdk-call.json'

 FAIL  |@eo/engine-claude| src/options-assembler.test.ts > … > standard-implementation.sdk-call.json is byte-identical to the committed golden
Error: ENOENT: no such file or directory, open '/home/eimi/projects/crabgic/packages/engine-claude/goldens/standard-implementation.sdk-call.json'

 FAIL  |@eo/engine-claude| src/options-assembler.test.ts > … > network-granted.sdk-call.json is byte-identical to the committed golden
Error: ENOENT: no such file or directory, open '/home/eimi/projects/crabgic/packages/engine-claude/goldens/network-granted.sdk-call.json'

 Test Files  2 failed (2)
      Tests  4 failed | 36 passed (40)
```

(The 4th failure in that run was `gateway-name-reference.test.ts`'s
sole-literal-scan sub-test — see **Deviations**, item 3 — tripped at that
point by this worker's OWN doc-comment prose quoting the literal in
`gateway-server-config.ts`/`gateway-server-config.test.ts`, fixed
immediately by rephrasing to reference the constant name instead of the
literal string, matching `packages/contracts/src/index.ts`'s own
established fix for the identical class of self-inflicted violation.)

The three `goldens/*.sdk-call.json` files were then generated (once, from
the real, passing implementation, mirroring
`packages/engine-core/scripts/write-goldens.ts`'s own documented
build-then-import-`dist`-then-write convention — this package owns no
`scripts/write-goldens.ts` of its own; the equivalent generation logic was
run as a throwaway script against `packages/engine-claude/dist/` and
`packages/engine-core/dist/` after `npx tsc -b`) and committed.

## Final GREEN

Command: `cd /home/eimi/projects/crabgic && npx vitest run --project @eo/engine-claude --coverage.enabled=false src/model-routing.test.ts src/version-gate.test.ts src/gateway-server-config.test.ts src/auth.test.ts src/options-assembler.test.ts`

```
 Test Files  5 passed (5)
      Tests  72 passed (72)
```

`gateway-name-reference.test.ts` (2 of its 3 sub-tests are this worker's own
modules' concern and are green; the 3rd — the repo-wide-within-the-package
literal scan — depends on every worker's files, see **Deviations** item 4):

```
 Test Files  1 passed (1)   [as of the last check where no other worker's
                              file violated the scan; see Deviations]
      Tests  3 passed (3)
```

`npx tsc -b` (repo root): clean, no errors, on every check after the fixes
in **Deviations** items 1–2.

Coverage (`npx vitest run --project @eo/engine-claude --coverage.enabled=true`,
this worker's five modules only — `event-normalizer.ts`/`limit-signal.ts`
belong to a concurrent worker (W2) and are outside this scope):

| Module                     | Stmts  | Branch | Funcs | Lines  |
| -------------------------- | ------ | ------ | ----- | ------ |
| `gateway-server-config.ts` | 100%   | 100%   | 100%  | 100%   |
| `model-routing.ts`         | 100%   | 100%   | 100%  | 100%   |
| `auth.ts`                  | 100%   | 100%   | 100%  | 100%   |
| `version-gate.ts`          | 93.33% | 88.23% | 100%  | 96.42% |
| `options-assembler.ts`     | 100%   | 100%   | 100%  | 100%   |

All five clear the ≥80% line+branch floor; `version-gate.ts`'s one uncovered
branch (line 84) is a defensive `undefined`-narrowing guard on
`RegExp.exec`'s capture groups that is unreachable in practice once the
outer pattern has already matched three mandatory groups — the identical,
already-established idiom as `packages/engine-core/src/footguns/
confinement-check.ts`'s `matchesPathRule` (`ruleTool === undefined ||
globLiteral === undefined || …`), required here only because
`noUncheckedIndexedAccess` types `RegExpExecArray` element access as
possibly-`undefined`.

## Deviations

1. **`model-routing.ts`'s RED was not captured in isolation** (see above) —
   it was implemented immediately after its test file, before the other
   four modules' RED was captured in the same run. Every module built
   after that point (`version-gate.ts`, `gateway-server-config.ts`,
   `auth.ts`, `options-assembler.ts`) has its RED captured verbatim above,
   consistent with phase-02's own recorded precedent for this exact
   situation.

2. **Two `tsc -b` fixes required after the first implementation pass**,
   both `--strict`-mode fallout, no behavior change:
   - `gateway-server-config.ts` imported the SDK's `Options` type only to
     reference it in a doc comment's mental model, never in code — removed
     the unused import (`TS6196`).
   - `version-gate.ts`'s `compareVersionTriples` indexed a fixed 3-tuple
     with a loop variable (`a[index] - b[index]`); under
     `noUncheckedIndexedAccess` a non-literal numeric index into even a
     fixed-length tuple type resolves to `T | undefined`. Rewritten to
     destructure the tuple positionally (`const [aMajor, aMinor, aPatch] =
a`), which TypeScript types exactly (no `undefined`) for a literal
     3-tuple. Same fix shape applied to `parseVersionTriple`'s
     `match[1]`/`match[2]`/`match[3]` extraction (an explicit
     `=== undefined` guard, matching `confinement-check.ts`'s own
     established idiom — see coverage note above).
   - `options-assembler.ts`'s `substitutePlaceholdersDeep<T>` reassigned a
     `typeof value === "string"`-narrowed generic-typed local
     (`T & string`) with the plain `string` result of
     `.split(...).join(...)` — TypeScript correctly rejects assigning
     `string` back into `T & string` for an unconstrained `T`. Fixed by
     using a separately-typed `string` local (`text`) inside that branch,
     only cast to `T` at the `return` (`as unknown as T`, the same escape
     hatch the function already uses for its array/object branches).

3. **Self-inflicted `gateway-name-reference.test.ts` violations, fixed
   immediately.** This worker's own `gateway-server-config.ts`/
   `gateway-server-config.test.ts` doc comments originally quoted the
   literal `"eo_gateway"` in prose (inside backticks) to explain the exit
   criterion the file itself satisfies — the scanner does a raw-text scan
   (matching `packages/contracts/src/gateway/server-name.test.ts`'s own
   documented convention: "raw-text `.split()` over every `.ts` file, not
   an AST-aware scan"), so prose mentions count as violations too. Fixed
   by rephrasing both comments to reference `GATEWAY_MCP_SERVER_NAME`'s
   _name_, never its literal value — the identical fix
   `packages/contracts/src/index.ts` already applied to its own analogous
   self-inflicted violation (recorded in `docs/evidence/phase-02/
README.md`'s Deviations §2).

4. **`gateway-name-reference.test.ts`'s sole-literal-scan sub-test is
   currently RED due to two other in-flight workers' files, not this
   worker's own code.** As of this evidence capture,
   `src/adjudication-policy.test.ts` (owned by a concurrent worker, W3) and
   `src/event-normalizer.test.ts` (owned by a concurrent worker, W2) each
   hand-type the literal `"eo_gateway"` in fixture strings rather than
   importing `GATEWAY_MCP_SERVER_NAME`. This worker did not modify either
   file — both are explicitly out of this worker's ownership scope
   (`adapter.ts`/`session.ts`/`event-normalizer`/`adjudication`/`live`
   files belong to other workers per the assignment brief). This is the
   scanner correctly doing its job against files still mid-TDD-cycle, the
   same class of transient multi-worker state phase-02's own evidence
   record documents for its identical `gateway/server-name.test.ts`
   sole-definition-site scanner (`docs/evidence/phase-02/README.md`,
   Deviations §2's second bullet: "this integration pass's own barrel …
   introduced a second violation of the same scanner … caught by the
   full-suite run during this same integration pass"). **A final
   integration-time re-run of `gateway-name-reference.test.ts` is required
   once every phase-06 worker's files have landed** — carried forward here
   exactly as that precedent recommends, not fixed unilaterally by editing
   another worker's files.

5. **ENGINE-FACT-DRIFT (mandatory per CLAUDE.md): `substituteWorktreePlaceholders`'s
   substitution semantics for the `//`-anchored permission-rule form are an
   explicit, documented open question, not silently resolved.**
   `packages/engine-core/src/compiler/owned-path.ts`'s own doc comment
   already flags that the real engine's matching semantics for
   `Edit(//<worktree-abs-path>/**)` are UNPROBED (`docs/engine-baseline.md`
   §3 records no path-anchor probe). This worker's implementation performs
   plain, uniform substring replacement of the placeholder tokens
   wherever they occur — no special-casing between the bare
   `sandbox.filesystem.allowWrite` form (`["<worktree>", …]`, becomes a
   clean single-leading-slash absolute path) and the `//`-anchored
   permission-rule form (`Edit(//<worktree>/rel/**)`, becomes
   `Edit(///abs/worktree/rel/**)` — three literal slashes, since
   `worktreePath` is itself validated absolute with its own leading `/`).
   The committed goldens (`goldens/*.sdk-call.json`) reflect this
   byte-for-byte. This worker deliberately did NOT invent an alternative
   (e.g. slash-stripping) substitution rule to paper over the gap — see
   `options-assembler.ts`'s `substituteWorktreePlaceholders` doc comment
   for the full writeup. Carried forward to the interface-ledger reconcile
   and to this package's own `@live` conformance suite (owned by a
   different worker, W5) as the probe that closes it.

6. **`packages/engine-claude/goldens/*.sdk-call.json` are not
   `prettier`-clean, by the same deliberate design as
   `packages/engine-core/goldens/*.json`.** These are machine-generated,
   byte-stability-contracted artifacts (`JSON.stringify(value, null,
2)` + one trailing newline + recursively-sorted keys — see
   `options-assembler.test.ts`'s `serializeGolden` doc comment), not
   hand-authored content for `npm run format` to reformat — identical
   rationale to `docs/evidence/phase-02/README.md`'s Deviations §8 and
   `packages/engine-core`'s own `.prettierignore` entry. **This worker did
   NOT add a `packages/engine-claude/goldens/` entry to the repo-root
   `.prettierignore`** — the assignment brief explicitly scopes this
   worker's writable surface to `packages/engine-claude/src/**`,
   `goldens/**`, and this evidence file, excluding "configs." Until that
   one-line addition is made (by whichever pass has `.prettierignore` in
   scope — mirroring exactly how `packages/contracts/schemas/` and
   `packages/engine-core/goldens/` each got their own entry from the
   worker who owned that broader integration step), `npm run format`
   will flag these three files. Flagged here for the integrator, not
   worked around unilaterally.

## SDK `sdk.d.ts` facts relied on (0.3.210, cited as the SDK's typed promise, never `docs/engine-baseline.md`)

- `Options.mcpServers?: Record<string, McpServerConfig>`; `McpStdioServerConfig
= { type?: 'stdio'; command: string; args?: string[]; env?: …; timeout?: …;
alwaysLoad?: … }`.
- `Options.sessionId?: string` / `Options.resume?: string` /
  `Options.forkSession?: boolean` — "Cannot be used with `continue` or
  `resume` unless `forkSession` is also set" (mutual-exclusivity note this
  worker's `WorkerSessionSpec` discriminated union makes structurally
  unrepresentable).
- `Options.settingSources?: SettingSource[]` (`SettingSource = 'user' |
'project' | 'local'`) — omission loads all sources; `[]` is SDK isolation
  mode.
- `Options.strictMcpConfig?: boolean`.
- `Options.settings?: string | Settings` — `Settings.permissions`/
  `Settings.sandbox` fields structurally match `@eo/engine-core`'s compiled
  `WorkerSettingsJson` shape field-for-field.
- `Options.sandbox?: SandboxSettings` — `network.allowAllUnixSockets?:
boolean` (the Linux/WSL2 UDS gate; distinct from the macOS-only,
  `string[]`-typed `allowUnixSockets`), `filesystem.{allowWrite,denyRead}`,
  `credentials.envVars[].mode: 'deny' | 'mask'`.
- `Options.systemPrompt?: string | string[] | { type: 'preset'; preset:
'claude_code'; append?: string; excludeDynamicSections?: boolean }`.
- `Options.outputFormat?: OutputFormat` (`OutputFormat = JsonSchemaOutputFormat
= { type: 'json_schema'; schema: Record<string, unknown> }`).
- `Options.includePartialMessages?: boolean`.
- `Options.canUseTool?: CanUseTool`, `Options.hooks?: Partial<Record<HookEvent,
HookCallbackMatcher[]>>`, `Options.abortController?: AbortController`,
  `Options.pathToClaudeCodeExecutable?: string` — all optional passthroughs
  this module accepts and forwards verbatim for the adapter (W4) to supply.
- `Options.env` — "REPLACES the subprocess environment entirely … When
  omitted, the subprocess inherits `process.env`" (the fact `buildWorkerEnv`'s
  from-scratch allowlist depends on).

## Open questions / carry-forwards

- Item 5 above (placeholder-substitution slash semantics) — owed to this
  package's `@live` suite (W5).
- Item 4 above (cross-worker `gateway-name-reference.test.ts` state) — owed
  to a final integration pass once every phase-06 worker's files land.
- Item 6 above (`.prettierignore` entry for `packages/engine-claude/goldens/`)
  — owed to whichever pass has repo-root config files in scope.
