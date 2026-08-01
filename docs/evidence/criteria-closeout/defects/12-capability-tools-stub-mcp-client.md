# Defect 12-capability-tools-stub-mcp-client

**Phase:** 12 — Stack detection & capability quarantine (`roadmap/12-stack-detection-quarantine.md`, exit criterion 5)

**Criterion (verbatim):**

> `capability.audit`/`capability.approve` resolve over the shared `crabgic_gateway` registry against a stub MCP client; `capability.approve` rejects a call lacking a pre-minted `trust approve` token.

**Found:** 2026-08-01, criteria-closeout pass (batch 0 pilot), at `4f2b33bbf68f517643a8d4f8eb5f85c793e99e3f`.

**Severity:** evidence-channel-only.

## Gap

The criterion is a conjunction. Its **second** clause is fully and non-vacuously evidenced;
its **first** clause lost its only test in an unrelated refactor and was never replaced.

### What exists

- `packages/detect/src/mcp/capability-approve-handler.test.ts` — the token clause, five
  fail-closed cases including the roadmap's own named "model-self-approval" seeded threat:
  - `:93` — `expect(result.approved).toBe(false);` for a fabricated, never-minted token, with
    `:94` `expect(store.load(saved.key)?.report.decision).toBe("pending");` proving no state moved
    and `:95` `expect(journal.entries).toHaveLength(0);` (added by #49) proving a refused approval
    journals nothing.
  - Plus wrong-digest (`:110`), replayed/consumed (`:130`) and wrong-subject-kind (`:144`) tokens.
- `packages/cli/src/gateway-mcp/build-tool-registry.test.ts:122-123, :138` — both tool names are
  present in the **real production registry** (`buildRealGatewayToolRegistry`), and `:143-144`
  asserts every registered tool has a real, invocable handler rather than a descriptor-only stub.
- `e2e/live/src/gatewayFamilyCompleteness.test.ts:22-29` — the `capability-audit-approve` family
  reports wired, against that same real registry. (This is `e2e/live`'s **offline** default
  project, not an `@live` suite.)

### What is missing

**No test at HEAD resolves `capability.audit` or `capability.approve` over an MCP client.**
The registry-membership assertions above are registry-level (`registry.toolNames`); they never
cross the MCP transport. The only tests that drive a real MCP client
(`packages/gateway/src/mcp/stdio-boot.test.ts`, `packages/gateway/src/mcp/server.test.ts`) do so
against a fixture registry holding one `probe.echo` tool
(`stdio-boot.test.ts:64-73`, asserted at `:91` as `expect(listed.map((t) => t.name)).toEqual(["probe.echo"])`),
and `e2e/live/src/gatewayFamilyCompleteness.ts:248` — the one place that boots the _real_ registry
over a real stdio MCP server — deliberately invokes `project.inspect`, not either capability tool.

### Search trail

1. `docs/evidence/phase-12/README.md` maps this criterion to
   `packages/detect/src/mcp/tool-definitions.test.ts`. `git ls-files packages/detect/src` — the
   file does not exist at HEAD.
2. `git log --diff-filter=D` — it was relocated to
   `packages/cli/src/gateway-mcp/detect-tool-definitions.test.ts` in `5c21a0f`
   ("relocate shared CLI-surface primitives to @crabgic/contracts, breaking the detect -> cli cycle"),
   then **deleted** in `c39292c` ("retire the hand-rolled MCP server and reconcile the audit trail")
   together with the hand-rolled `gateway-mcp/{protocol,stdio-server}.ts` it drove. Its
   `tools/list` assertion — `expect(names).toEqual(["capability.approve", "capability.audit"])`,
   read back verbatim from `git show c39292c^:packages/cli/src/gateway-mcp/detect-tool-definitions.test.ts` —
   was the exact evidence this criterion names. `c39292c` was a correct deletion (that server
   could never dispatch `tools/call`); what it did not do was re-establish the assertion against
   the MCP SDK server that replaced it.
3. `grep -rn "connectGatewayMcpStdio\|buildGatewayMcpServer" packages e2e` — five call sites,
   each inspected; none lists or calls a `capability.*` tool.
4. `grep -rn "tools/list\|tools/call\|callTool" --include=*.ts packages e2e` — same conclusion.

### Why this is not merely bookkeeping

`packages/cli/src/gateway-mcp/build-tool-registry.ts:428-431` re-declares the shipped tools from
`CAPABILITY_AUDIT_TOOL.name`/`.description` while supplying a **new** `GatewayToolRegistry`-shaped
input schema, rather than reusing the descriptor's original `inputSchema`. The MCP-transport hop is
therefore the first place a schema or naming mistake in that re-declaration could surface, and it is
exactly the hop nothing currently covers. It is `evidence-channel-only` rather than
`blocking-guarantee` because the transport itself is generically proven for any registry
(`stdio-boot.test.ts:99-111` invokes a registered tool through a real `tools/call`), so the residual
risk is confined to these two tools' own descriptors.

## Proposed remedy

Add one test — in `packages/cli/src/gateway-mcp/` (the package that owns both halves of the 09/12
seam, per `5c21a0f`'s own relocation rationale) — that:

1. builds the **real** registry via `buildRealGatewayToolRegistry({ xdgEnv, projectHash })` against
   a tmp `HOME`, exactly as `build-tool-registry.test.ts` already does;
2. boots it with `connectGatewayMcpStdio` over `PassThrough` streams (the no-hang convention
   `e2e/live/src/gatewayFamilyCompleteness.ts:200-250` and `stdio-boot.test.ts:16-62` both use);
3. asserts a `tools/list` response contains `capability.audit` and `capability.approve` with
   non-empty descriptions;
4. asserts a `tools/call` of `capability.approve` with a fabricated token returns a refusal rather
   than an approval — closing the loop between the transport and the fail-closed behaviour that is
   today only proven at the plain-function level.

**Effort:** S. **Needs CI:** no. **Needs live engine:** no. **Needs owner input:** no.

**Ticket-ready:** yes.

## Related, not part of this defect

`docs/evidence/phase-12/README.md`'s mapping table still names the deleted
`src/mcp/tool-definitions.test.ts` and still spells the registry `eo_gateway` (pre-rename; the
settled name is `crabgic_gateway`, `GATEWAY_MCP_SERVER_NAME`, interface-ledger Gap 11). That README
is a historical build record and was deliberately left unedited by this pass. The remedy above
should refresh the row it invalidates.
