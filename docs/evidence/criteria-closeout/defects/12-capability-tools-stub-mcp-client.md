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

## Remedied 2026-08-06

The remedy landed as `packages/cli/src/gateway-mcp/capability-tools-over-stdio.test.ts` (PR #111,
on main at `c0b3873`), and the closeout wave's docs batch flipped the record against it. The body
above is left verbatim; this is the dated addendum.

### The four numbered remedy points, against what the merged test actually does

| #   | Asked for                                                                                                                                                        | Landed                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | build the **real** registry via `buildRealGatewayToolRegistry` against a tmp `HOME`                                                                              | done — the suite's `realRegistry()` helper, with `HOME` a fresh `mkdtemp` per test                                                                                                                                              |
| 2   | boot it with `connectGatewayMcpStdio` over `PassThrough` streams                                                                                                 | done — the no-hang convention, exactly as sketched                                                                                                                                                                              |
| 3   | assert a `tools/list` response contains both tools with non-empty descriptions                                                                                   | done at `packages/cli/src/gateway-mcp/capability-tools-over-stdio.test.ts:151-152`, over an anti-vacuity floor at `packages/cli/src/gateway-mcp/capability-tools-over-stdio.test.ts:147` that an empty tool list cannot satisfy |
| 4   | assert a `tools/call` of `capability.approve` with a fabricated token returns a refusal — "closing the loop between the transport and the fail-closed behaviour" | done as a refusal, **but not as the loop this point imagined** — see below                                                                                                                                                      |

### The one deviation, and it is the more honest shape

Point 4 assumed the transport-level refusal would close the loop on **the token clause**. It does
not, and the merged test says so about itself rather than letting a reader assume it:

> The refusal observed here is produced by the DIGEST guard — no audited capability is stored under
> the digest — and not by the token check. Mutating only the token-verification seam leaves this
> green, because the digest guard returns first. Only removing BOTH guards, so the tool genuinely
> approves, reddens it (measured: 1 failed / 18 passed).

So the suite bears the criterion's **first** clause — the two tools resolve over the shared registry
and fail closed when reached through a real MCP client — and explicitly **does not** bear the second.
Exercising the token path over the transport would need an audited capability seeded into the real
store first; that is left to `packages/detect/src/mcp/capability-approve-handler.test.ts`, which
seeds one and drives the token path proper. Naming the split beats a suite that quietly appears to
cover both.

Two smaller things the merged suite records that the remedy sketch did not anticipate, both worth
keeping:

- an earlier draft sent `{ capabilityId, approvalToken }` and **passed — because the arguments
  failed schema validation**, not because the tool failed closed. Mutating the handler to return
  `{ approved: true }` unconditionally left it green, which is what exposed it. The committed test
  sends the tool's real `{ digest, token }` schema;
- the refusal is asserted as "not approved" **plus** a match on the layer that produced it
  (`/no audited capability is stored under digest/i`), rather than on a message string alone —
  because a message match can succeed against both the refusal and the success path.

### A line-number correction, and every copy of it

The Gap section above cites `packages/detect/src/mcp/capability-approve-handler.test.ts:93` with
`:94` and `:95` as its siblings. The third assertion, `expect(journal.entries).toHaveLength(0);`, is
on **`packages/detect/src/mcp/capability-approve-handler.test.ts:96`**; `:95` is the comment above
it. The correct span is `93-96`.

Per the rule that correcting a line number means grepping for every copy of it, all three were
found: the closeout record (corrected), the `roadmap/12-stack-detection-quarantine.md:84` annotation
(rewritten with the corrected span), and this record's own body — **left as written**, because it is
a verbatim capture pinned to `4f2b33b` and a merged record's capture is annotated, never retro-edited.

### The "Related, not part of this defect" items, discharged

Both were discharged **in place**, with dated in-line corrections that do not move a single line of
`docs/evidence/phase-12/README.md` (checked: no reference anywhere at `origin/main` cites that file
by line number, but an evidence record is worth the care anyway):

- the **mapping-table row** for this criterion, which still named the deleted
  `src/mcp/tool-definitions.test.ts` and spelled the registry `eo_gateway`, now carries a dated
  correction naming the relocation (`5c21a0f`), the deletion (`c39292c`) and the suite that
  re-established the assertion, and points at the file's own 2026-08-02 rename annotation for the
  registry spelling;
- **carry-forward (b)** — "there is no real dispatch path from an actual MCP tool CALL to these
  handlers today" — is marked discharged, with the digest-vs-token precision carried across so the
  discharge is not read as wider than it is.

### Why the flip is `EVIDENCE-REPRODUCED`

The suite was re-run locally at the tree this branch lands as: 1 file / 3 tests passed. Per-push
execution is proven by the job-log delta pair (635→636 files, 6480→6483 tests between runs
31087750630 and 31089667556), with a control row whose count does not move and the one confounding
PR's test file checked count-unchanged — not by a green workflow badge, which proves only that the
workflow passed.
