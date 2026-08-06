# 02 — the `crabgic_gateway` sole-definition-site check does not cover `packages/*`

**Phase:** 02 — Core contracts, state machines, canonical errors
(`roadmap/02-contracts-and-schemas.md`, exit criterion 8)

**Criterion (verbatim):**

> `GATEWAY_MCP_SERVER_NAME` is the sole definition site of the literal `"crabgic_gateway"` — a repo-wide grep/golden-value CI check fails if the literal appears a second time under `packages/*`.

**Found:** 2026-08-01, criteria-closeout pass batch 1 (phase 02), at `65ff0da`.

## Gap

The criterion states a behaviour that does not hold at HEAD: **the literal does appear a second
time under `packages/*`, hand-typed, and the CI check is green.**

What exists — `packages/contracts/src/gateway/server-name.test.ts`:

- `:76` `expect(GATEWAY_MCP_SERVER_NAME).toBe("crabgic_gateway")` — the golden-value half, met.
- `:79-96` a recursive read-only walk collecting every `.ts` file under each `packages/<pkg>/src`,
  skipping `node_modules`/`dist`, allowlisting exactly two paths (`server-name.ts` and this test),
  and asserting `expect(violations).toEqual([])`.

That scan's scope is `packages/*/src/**/*.ts`. The criterion's scope is `packages/*`. The
difference is populated:

| Occurrence                                                     | In the scan?                              | Derived from the constant?                                                                                                                     |
| -------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/gateway/server-name.ts`                | allowlisted                               | is the definition                                                                                                                              |
| `packages/contracts/src/gateway/server-name.test.ts`           | allowlisted                               | the golden test                                                                                                                                |
| `packages/engine-core/goldens/*.json` (6 files)                | no — not `.ts`, not under `src`           | **yes** — written by `packages/engine-core/scripts/write-goldens.ts`; regenerated during this pass for an empty diff                           |
| `packages/engine-claude/goldens/*.sdk-call.json` (3 files)     | no                                        | **yes** — `packages/engine-claude/src/options-assembler.test.ts` regenerates each in-process and asserts byte-identity with the committed file |
| `packages/engine-claude/README.md`                             | no                                        | prose                                                                                                                                          |
| `packages/engine-claude/src/live/fixtures/stub-mcp-server.mjs` | no — `.mjs`, outside the extension filter | **no** — hand-typed (inside a comment)                                                                                                         |
| `packages/plugin/.mcp.json`                                    | no — not `.ts`                            | **no** — hand-typed, committed, shipped, functional                                                                                            |

`packages/plugin/.mcp.json` is the load-bearing one. It is the plugin package's own shipped MCP
manifest:

```json
{ "mcpServers": { "crabgic_gateway": { "command": "crabgic", "args": ["gateway", "mcp"] } } }
```

Nothing offline binds that key to `GATEWAY_MCP_SERVER_NAME`. The only check that reads it is
`packages/plugin/src/live/plugin-load.live.test.ts:51`, an `@live` suite that does not run in CI.
By contrast the **installer's** generated `.mcp.json` entry _is_ correctly bound —
`packages/cli/src/installer/mcp-entry.golden.test.ts:24-29` builds the key from the imported
constant, and its own header comment says it avoids hand-typing the literal precisely because of
this scanner. Two artifacts, one bound and one not.

This directly contradicts roadmap/02 §In scope's own words for this constant: _"the single literal
every engine-side MCP registration derives from (… 10's `.mcp.json` entry key …); no phase
hand-types the literal a second time."_

The check does work within its scope: a negative control run during this pass appended the literal
to `packages/journal/src/index.ts` and the suite failed
(`AssertionError: expected [ { …(2) } ] to deeply equal []`). It is also missing an
empty-glob guard — `findPackageSrcDirs()` tolerates missing directories and nothing asserts the
walk found any files, so a future refactor that broke the path computation would certify the
absence rather than report it. (The sibling check `packages/detect/src/spawn-surface-scan.test.ts`
does carry such a guard: `expect(ALL_SOURCE_FILES.length).toBeGreaterThan(10)`.)

**Search trail.** `packages/contracts/src/gateway/server-name.test.ts` (the named check);
`docs/evidence/phase-02/README.md` map row + §Deviations 2 (records the check firing twice during
integration, so it has real history); `docs/interface-ledger.md` Gap 11 (the ruling —
`GATEWAY_MCP_SERVER_NAME = "crabgic_gateway"`, every registration derives from it);
`git grep -c -F crabgic_gateway -- packages/` (14 files); `grep -rn "GATEWAY_MCP_SERVER_NAME"
packages/*/src --include=*.test.ts -l` (10 test files, all importing the constant rather than
typing the literal — the `.ts` discipline is genuinely held); searched
`packages/plugin/src/**` for any test reading `.mcp.json` (none — only `resolvePluginRoot`
consumers for `plugin.json`, `marketplace.json` and `hooks.json`).

Full transcript: `docs/evidence/phase-02/closeout-c8-gateway-literal-scan.txt`.

## Why this is UNMET and not a wording correction

The wording protocol allows a _more precise_ claim, never a _weaker_ one. Rewriting the criterion
to say "under `packages/*/src`, `.ts` only" would be weaker in exactly the way that matters: it
would retire a guarantee that a shipped artifact is currently violating, and would leave the
plugin manifest free to drift from the constant with no check anywhere. That is a lost guarantee,
so the box stays unticked.

## Severity

**blocking-guarantee** — but scoped honestly: the guarantee lost is _drift detection_, not runtime
security. Today the strings agree, so nothing is broken in the product. If
`GATEWAY_MCP_SERVER_NAME` were ever changed, every `.ts` consumer would follow automatically, the
scanner would stay green, and `packages/plugin/.mcp.json` would silently ship the old name — the
plugin-installed gateway would register under a server name the compiled permission allow-string
(`mcp__${GATEWAY_MCP_SERVER_NAME}__*`, phase 03) no longer matches. That is the
"allowlist and spawn config disagree on the server name" failure mode `docs/threat-model.md`
§"Cross-cutting mitigations" claims this constant closes _structurally_.

## Proposed remedy

Smallest honest fix, in preference order:

1. **Widen the scan (S).** In `packages/contracts/src/gateway/server-name.test.ts`, walk every
   _tracked_ file under `packages/` rather than `.ts` under `src/`, with an explicit allowlist for
   the two definition-site paths and for the generated/derived goldens (each of which already has
   its own regeneration check). Add the missing empty-glob guard while there
   (`expect(scannedFiles.length).toBeGreaterThan(N)`), so the absence cannot be certified by a
   broken walk.
2. **Bind the plugin manifest (S).** Add an offline test in `packages/plugin` that reads
   `packages/plugin/.mcp.json` via `resolvePluginRoot` and asserts
   `Object.keys(json.mcpServers)` equals `[GATEWAY_MCP_SERVER_NAME]` and the entry equals
   `buildGatewayMcpServerEntry()`. This is worth doing even if (1) lands, because it converts the
   manifest from "not a second hand-typed literal" into "provably derived", and it is the shape
   `mcp-entry.golden.test.ts` already established for the installer.
3. Re-tick criterion 8 once both are green, citing the widened scan and the new binding test.

Neither step needs CI minutes beyond the normal push, the live engine, or owner input.
Combined effort: **S**. Owner input: none. Live engine: no. New CI job: no.

**Ticket-ready:** yes.

## Remedied 2026-08-06

All three proposed remedy steps are done.

**Step 1 (widen the scan).** `packages/contracts/src/gateway/server-name.test.ts:144-155` walks
every _tracked_ file under `packages/` via `git ls-files -z -- packages` rather than `.ts` under
`packages/*/src`. Measured scope change: **1055 -> 1505** files. `git ls-files` rather than a
directory walk, deliberately — a working-tree walk would also sweep `dist/`, which contains the
literal as compiled output, so it would have needed a skip list to stay green, and a skip list is
how this check got narrow in the first place.

The missing empty-glob guard this record asked for is at `:168`
(`expect(scanned.length).toBeGreaterThan(500);`), plus a second floor in the other direction at
`:189` (`expect(allowlistedHits).toBeGreaterThanOrEqual(ALLOWLIST.size);`) — a walk that read no
file _content_ would otherwise also certify the absence, since it would find no violations either.

**Step 2 (bind the plugin manifest).** `packages/cli/src/installer/mcp-entry.golden.test.ts:115-133`
asserts `packages/plugin/.mcp.json`'s only `mcpServers` key is `GATEWAY_MCP_SERVER_NAME`, that its
entry equals `buildGatewayMcpServerEntry()`, and that the whole document equals `mergeMcpJson({})`.
It lives in `packages/cli` rather than `packages/plugin` because `buildGatewayMcpServerEntry` is
cli-owned and the reverse import would invert the package graph.

**Step 3.** Criterion 8 is ticked, citing both.

**Negative control, which is what shows the widening is load-bearing.** Appending the literal to
`packages/plugin/.claude-plugin/plugin.json` — a non-`.ts` file outside every `src/` — fails the
widened scan naming that exact path, while `git ls-files -- 'packages/*/src/**/*.ts' | grep -c
plugin.json` returns **0**, so the old scope could not have caught it.

**One design note beyond the remedy as written.** Twelve files under `packages/` carry the literal
besides the two definition sites, and an allowlist that merely tolerates them would be the same
defect wearing a new coat. Each entry therefore carries a stated `reason`, and every
non-definition entry names the test that proves the occurrence is _derived_ from the constant —
asserted to exist at `:215`, so deleting a derivation test breaks the scan rather than silently
leaving an unjustified exemption. Nine are goldens regenerated by
`packages/engine-core/src/goldens/generate-golden-artifacts.test.ts`, one is the manifest bound by
step 2, and two are prose (a README, and a doc comment recording a live observation).
