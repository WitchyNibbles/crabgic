# Interface Ledger — Crabgic Roadmap

This file is the **binding cross-phase interface contract** for the crabgic / Crabgic
roadmap (`roadmap/00-*.md` through `roadmap/23-*.md`, indexed by `roadmap/README.md`). It records the single
ruling decision for each of 15 cross-phase interface gaps that were identified against the roadmap and
independently adjudicated by four parallel resolver passes, plus **Gaps 16-20**, which were identified later
and each carry their own provenance line rather than a four-resolver record:

| Gap | Origin |
| --- | --- |
| 16  | phase-23 implementation |
| 17  | reported behavior in a consuming repo, 2026-07-27 |
| 18  | owner ruling 2026-07-28, after a live audit of the shipped `crabgic@1.3.0` binary |
| 19  | owner ruling 2026-07-28, same session as 18; **amended 2026-07-29** against measured evidence |
| 20  | raised 2026-07-29 while implementing 19's amendment |

This table exists because the sentence above it said "15 gaps plus Gap 16" for as long as there were twenty,
which is a small thing that makes a reader trust the rest of the file less. A ledger that miscounts itself
invites the question of what else it has not kept up with.

**The four resolver passes did not agree with each other** — on several gaps (notably Gap 1, Gap 2, Gap 11,
and the path-order half of Gap 14) their decisions materially conflict, even though all 15 gaps were stamped
`RESOLVED` by all four. **This ledger is not a vote count.** For every one of **Gaps 1-15** below, the "Ruling"
is the decision the 22 already-rewritten phase files actually implement today, verified by reading those files
directly — not the majority position among the four resolvers, and not editorial preference. Each carries a
"Where the 4 resolvers disagreed" line naming the rejected alternative(s) on the record, so nobody
reintroduces a rejected branch later believing it was never considered. Gap 16 has no such line and makes no
such claim: it was never seen by the four resolvers, and its ruling is carried today both by the implementing
source files and — since the coordinated addition to `roadmap/01`, `15` and `23` — by those phase files' own
text; see its own "Origin" and "Coordinated phase-file edit" lines in that entry.

**Any change to a named interface below — a tool name, a schema member, a shared constant, a path
convention, an enum label, a delivery boundary — requires a coordinated edit across every phase file listed
under that gap's "Phases affected."** Do not edit one phase's copy of a shared interface without updating the
others in the same change; do not reopen a ruling marked resolved below without an equally coordinated
resolution round across every affected phase.

Two phases — **05 (`05-supervisor-daemon.md`) and 16 (`16-gateway-core.md`)** — were still being rewritten
when this ledger's gaps were first drafted; both have since been fully rewritten and now carry the ruling
throughout (Phase 16's Goal/In-scope/Interfaces-produced/Exit-criteria sections name `GATEWAY_MCP_SERVER_NAME`,
`evidence.get`/`evidence.attach`, `result.submit`, and forwarded `run.status`/`run.cancel` explicitly; Phase
05's Goal and "Router surface" bullet carry the matching gateway-forwarding framing). Four gaps (1, 2, 8, 11)
partly land in those two files. For each, this ledger verifies the ruling directly against 05/16's own current
text, alongside every *other* phase that declares, registers into, or consumes the interface.

---

**Audit note (2026-07-15):** An independent 22-agent validation re-checked every ruling below against the
current phase files. Ten of fifteen were confirmed verbatim and no rejected branch survives anywhere in the
corpus. Five coordinated corrections were then applied: the gateway MCP family count is fixed at **8** — an
earlier "9-family" miscount that special-cased `evidence.*` was retired from Phases 09/11/16/23 (Gap 1); the
`renderer-core` pointer is corrected to Phase 02 **work item 6** (Gap 3); Phase 00's permission-probe literal
list now names all four doc-confirmed forms, matching Phase 03 (Gap 12); the Gap 7 note claiming "06 does not
name these fields" is corrected (it does, consistently); and the "Phases affected" sets for Gaps 4, 5, 10, and
11 are expanded to every real writer/consumer so the coordinated-edit guarantee stated above is actually safe.

## Index

| # | Gap | Ruling (one line) |
|---|---|---|
| [1](#gap-1--gateway-mcp-tool-surface-is-fragmented) | Gateway MCP tool surface fragmented | One `crabgic_gateway` registry hosted by Phase 16; `change_set.*`/`learning.*` deleted; `run.status`/`run.cancel` forwarded over UDS |
| [2](#gap-2--cli-gateway-mcp-subcommand-never-declared) | CLI `gateway mcp` never declared | Declared in Phase 09, backend Phase 16's registry, no user-facing flags |
| [3](#gap-3--packagesengine-core-and-renderer-core-are-unscaffolded) | `engine-core`/`renderer-core` unscaffolded | `engine-core` = 18th package (Phase 01); `renderer-core` = module inside `packages/contracts` (Phase 02), not a package |
| [4](#gap-4--parkedrate_limit-is-missing-from-the-phase-02-run-lifecycle-state-machine) | `parked:rate_limit` missing from run lifecycle | New orthogonal `WorkUnitAttemptStatus` union (6 members); Run lifecycle untouched |
| [5](#gap-5--no-journal-entry-type-enum-is-ever-named) | No journal entry-type enum named | `JournalEntryType`, 13 members, owned by Phase 02 |
| [6](#gap-6--prreview-comment-artifacts-are-rendered-with-no-delivery-mechanism) | PR/review-comment artifacts have no delivery mechanism | Terminal handoff copy only, attached as evidence, retrieved via `evidence <change-set-id>`; no VCS connector, ever |
| [7](#gap-7--engineadaptercapabilities-field-name-mismatch) | `capabilities()` field-name mismatch | `supportsJsonSchema`/`supportsSessionResume` win (adaptation doc's names) |
| [8](#gap-8--resultsubmit-vs-result_submit) | `result.submit` vs `result_submit` | `result.submit` (dot form) wins |
| [9](#gap-9--phase-12--phase-13-consumption-claim-contradicts-the-dependency-graph) | Phase 12→13 consumption claim contradicts the graph | Fixed: consumed by Phase 11, not 13 |
| [10](#gap-10--capability-flag-label-drift) | Capability-flag label drift | Phase 02's labels win verbatim: `closing transitions`, `bulk mutations` |
| [11](#gap-11--crabgic_gateway--mcpcrabgic_gateway-literal-names-never-echoed-in-the-roadmap) | `crabgic_gateway` literal never pinned | Named constant `GATEWAY_MCP_SERVER_NAME` owned by Phase 02, imported everywhere |
| [12](#gap-12--permission-rule-syntax-drift-from-the-cited-baseline) | Permission-rule syntax drift | No space before colon; only the 4 doc-confirmed literals; wider cases routed to a Phase 00 probe |
| [13](#gap-13--minor-phase-03s-sources-field-never-cites-docsengine-baselinemd) | Phase 03 doesn't cite `docs/engine-baseline.md` | Citation added |
| [14](#gap-14--minor-two-independent-xdg-cache-usages-with-no-shared-pinned-path-constant) | Two unpinned "XDG cache" usages | Pinned once in Phase 04, sibling to `$XDG_STATE_HOME` |
| [15](#gap-15--minor-engine-live-ci-job-name-and-live-test-tag-never-explicitly-linked) | `engine-live`/`@live` link never stated | Phase 01 states Phase 06 wires it; Phase 06 does |
| [16](#gap-16--phase-23-ci-produced-evidence-records-have-no-pinned-path-env-or-failure-convention) | Phase-23 CI-produced evidence records unpinned | `docs/evidence/phase-23/<record>.json` + `CRABGIC_<RECORD>` override + `.strict()` schema read through `safeParse`; a malformed record is a FAIL, never a throw |
| [17](#gap-17--the-manager-session-has-no-operating-protocol-and-manager-hooks-may-not-block) | Manager session has no operating protocol | Protocol owned by `@crabgic/plugin`'s `manager-protocol.ts`, always shipped in the `CLAUDE.md` managed block (additive to the `@AGENTS.md` bridge, never replaced by it); `Stop` may block via the autonomy gate, `PreToolUse` still may not |
| [18](#gap-18--approval-is-pinned-per-changeset-to-a-command-the-user-must-type) | Approval pinned to a per-ChangeSet terminal prompt | Standing `EnvelopePolicy` (02, written by `install`, owner-only, never in the repo); dispatch does a containment check — inside it runs with no prompt, outside it halts on `expanded_authority`; no session-reachable surface may widen it |
| [19](#gap-19--adversarial-quality-loops-collide-with-exhausted_repairs) | Adversarial quality loops vs `exhausted_repairs` | Different loops: repairs stay capped at initial + 2; roast rounds are read-only, uncapped, and close when a round yields no **novel + falsifiable** finding — no severity floor, fresh reviewer per round |

---

## Gap 1 — Gateway MCP tool surface is fragmented

**Gap statement:** The adaptation doc treats the gateway MCP tool surface as one settled, ~9-family list on a
single server. In the roadmap as originally drafted, only `tracker.*`/`observability.*` were fully specified
(in Phase 16); `project.inspect`/`contract.approve` (Phase 11), `capability.audit`/`capability.approve`
(Phase 12), `evidence.*`, `result.submit`, and forwarded `run.status`/`run.cancel` were scattered or
contradictory, and a `change_set.*` and a `learning.*` family were asserted by some readings with zero
roadmap presence.

**Ruling:** There is exactly **one** MCP server, `crabgic_gateway` (`GATEWAY_MCP_SERVER_NAME`, Gap 11), exposing a
single **extensible tool registry** hosted by Phase 16 (`packages/gateway`) and booted by Phase 09's
`gateway mcp` CLI subcommand (Gap 2).

- Phase 16 natively implements and registers: `tracker.search/get/plan_create/plan_update/plan_transition/
  plan_comment/apply`, `observability.search/get/query/plan_create/plan_update/apply`, `evidence.get`,
  `evidence.attach`, `result.submit` (dot form, Gap 8), and **forwarded** `run.status`/`run.cancel` — thin
  MCP-visible wrappers that forward over UDS to Phase 05's supervisor. The UDS call is Phase 05's
  pre-existing internal transport, not a second implementation.
- Phase 11 registers `project.inspect` (which **also answers ChangeSet-state queries** — see below) and
  `contract.approve` (verify-only) into the same registry, at its own build time, with **no relocation** of
  its handler logic into `packages/gateway` and no new 16→11 dependency edge.
- Phase 12 registers `capability.audit` and `capability.approve` the same way — no relocation into
  `packages/gateway`, no new 16→12 edge.
- Aggregation mechanism: an **extensible registry** — Phase 16 registers its own families at its own build
  time; Phase 11/12 (already dependents of Phase 09) register their own already-built handlers into that
  same registry when those phases land, with no new cross-phase dependency edge required.
- **There is NO `change_set.*` tool family.** Deleted; folded into `project.inspect`, the sole
  ChangeSet-state read surface.
- **There is NO `learning.*` tool family.** Deleted; promotion/review is CLI-only
  (`learn list|approve|reject|rollback`, Phase 09/22) — structurally required by Phase 22's own tested
  invariant that an active run can never promote its own policy. Phase 22 carries a grep-based CI check over
  `packages/gateway`'s registered tool names permanently enforcing this absence.

Counting `tracker.*`, `observability.*`, `evidence.get`/`evidence.attach` (one family — the same
top-level-prefix grouping already applied here to `run.*` and `capability.*`), `result.submit`,
`run.status`/`run.cancel` (one forwarded family), `project.inspect`, `contract.approve`, and
`capability.audit`/`capability.approve` (one family) gives **8** families. This is now stated consistently across the corpus: `16-gateway-core.md`'s Risks
recomputation and Phase 09/11/23's release-gate phrasing were all corrected (2026-07-15) from an earlier
"9-family" miscount that special-cased `evidence.*` into two families while still grouping
`run.*`/`capability.*` — a hybrid no single counting rule produces (consistent prefix-grouping gives 8;
consistent leaf-counting gives 11).

**Phases affected:** 02, 05, 06, 09, 11, 12, 16, 22, 23

**Verified in:**
- `09-cli-and-doctor.md` §In scope, "`gateway mcp`" bullet — *"No `change_set.*` or `learning.*` tool family
  exists anywhere, and this command never grows one,"* plus the full registry/registration-mechanism
  description ("11 and 12 — already dependents of this phase — each register their own already-built
  handlers … into the same registry when those phases land, with no new cross-phase dependency edge
  required").
- `11-intake-contract-approval.md` §Out of scope, line 59 — *"A `change_set.*` MCP tool family — deliberately
  does not exist anywhere in v1 (Gap 1 resolution); `project.inspect` is the sole ChangeSet-state read
  surface"*; §In scope, `project.inspect` bullet, line 23 — *"Also answers ChangeSet-state queries; no
  separate `change_set.*` tool family exists."*
- `12-stack-detection-quarantine.md` §Interfaces produced, line 38 — *"MCP tools `capability.audit`,
  `capability.approve` — implementation stays in `packages/detect` (unchanged: no relocation into
  `packages/gateway`)… no new dependency edge, since this phase already depends on 09."*
- `22-learning-system.md` §In scope "Separation of duties," line 17, and §Interfaces produced, line 43 —
  *"No MCP `learning.*` tool family exists… a model-invokable promotion tool would violate this section's
  tested invariant"*; §Exit criteria, line 75 — *"a grep-based CI check over `packages/gateway`'s registered
  tool names confirms no `learning.*` MCP tool exists to route around it (Gap 1)."*
- `02-contracts-and-schemas.md` §Out of scope, line 36 — MCP tool implementations "owned by 16/11/12; this
  phase only names the server constant."
- `06-claude-engine-adapter.md` §Out of scope, line 30 — names the full Phase-16-owned family list
  (`tracker.*, observability.*, evidence.get, evidence.attach, result.submit's server-side handler, forwarded
  run.status/run.cancel`).
- `23-release-hardening.md` §Interfaces consumed, row "16," line 76 — *"tool surface (`tracker.*`,
  `observability.*`, `evidence.get`, `evidence.attach`, `result.submit`, `run.status`/`run.cancel`
  forwarding)"*; §Exit criteria, line 129 — *"Full 8-family gateway MCP tool surface… zero
  `NOT_IMPLEMENTED` remains (09/16, Gap 1/Gap 2's explicit phase-23 obligation)."*
- **`16-gateway-core.md` itself now carries the ruling throughout** — §Goal: *"This phase natively implements
  `tracker.*`, `observability.*`, `evidence.get`, `evidence.attach`, and `result.submit`, and forwards
  `run.status`/`run.cancel` over UDS to 05's own router"*; §In scope, "Sole MCP host & extensible
  tool-registration API" bullet names `GATEWAY_MCP_SERVER_NAME`, `evidence.get`, `evidence.attach`,
  `result.submit`, and forwarded `run.*` explicitly; §Interfaces produced and §Exit criteria repeat the
  identical set. **`05-supervisor-daemon.md`'s UDS API bullet carries the matching gateway-forwarding
  framing** — §Goal: *"trusted by exactly two local peers sharing the invoking uid: the CLI (09), and the
  gateway (16), which forwards its own `run.status`/`run.cancel` MCP tools over the identical protocol"*;
  §In scope, "Router surface" bullet: *"the MCP-visible `run.status`/`run.cancel` tools are 16's forwards,
  implemented once, here."* Phase 09 itself flags the one remaining open wiring detail — *"How 16's tool
  families physically reach this phase's registry is not fully specified"* (§Risks & open questions) — which
  is an implementation detail, not a reopening of this ruling.

**Where the 4 resolvers disagreed:** Two of the four kept and built out real `change_set.*` and `learning.*`
families (one had Phase 16 forward them as new UDS ops; the other had Phase 05/22 register them directly
into Phase 16's registry) — both rejected. A third resolver additionally argued `run.*` should never be
MCP-visible at all (UDS-only) — also rejected: `run.status`/`run.cancel` **are** forwarded MCP tools per
Phase 23's own tool-surface citation. The implemented design matches the one resolver who deleted both
`change_set.*`/`learning.*`, kept `capability.*`/`project.inspect` in place (register-only, no relocation),
and forwarded `run.*`.

---

## Gap 2 — CLI `gateway mcp` subcommand never declared

**Gap statement:** Adaptation §6.1 names the literal invocation `crabgic gateway mcp` as the
exact `.mcp.json` stdio command Phase 10 writes, but no earlier draft of Phase 09 (owner of the CLI surface)
declared any such subcommand.

**Ruling:** `gateway mcp` is a command owned and declared by Phase 09 (`packages/cli`), taking **no
user-facing flags**, running as a **long-running stdio process**. It boots the `crabgic_gateway` MCP server over
Phase 16's extensible tool registry (Gap 1), addressed by the `GATEWAY_MCP_SERVER_NAME` constant (Gap 11).
Phase 09 supplies only the argv shim, help text, and stdio boot — it implements none of the registered
tools' logic. This is the exact string Phase 10 writes as the `command`/`args` of the `.mcp.json` entry keyed
`GATEWAY_MCP_SERVER_NAME`: `{"crabgic_gateway": {"command": "crabgic", "args": ["gateway",
"mcp"]}}` (byte-golden-tested in Phase 10). Full 8-family tool-surface completeness (zero `NOT_IMPLEMENTED`)
is explicitly deferred to Phase 23's release gate, not required at Phase 09/16's own build time.

**Phases affected:** 09, 16

**Verified in:**
- `09-cli-and-doctor.md` §In scope — *"gateway mcp: boots the `crabgic_gateway` MCP server (stdio) over
  `packages/gateway`'s (16) extensible tool registry…"*; §Work items 1–2; §Exit criteria, line 203 —
  *"`gateway mcp` starts and lists exactly the resolved tool set over stdio to a stub MCP client… full
  8-family completeness remains a phase-23 release gate."*
- `10-plugin-and-installer.md` §Work items 2 — golden-file test of the `{"crabgic_gateway": {"command":
  "crabgic", "args": ["gateway", "mcp"]}}` shape; §Exit criteria — byte-for-byte assertion
  against the same literal.
- `23-release-hardening.md` §Interfaces consumed, row "09," line 69 — *"Full CLI surface incl. `gateway mcp`
  (Gap 2)"*; §Exit criteria, line 129 — "Gap 1/Gap 2's explicit phase-23 obligation."
- `16-gateway-core.md` now explicitly describes itself as this command's backend — §Goal: *"09's `gateway
  mcp` command is a thin argv shim that boots this phase's server over stdio"*; §Out of scope repeats it:
  *"this phase supplies the server 09's shim boots, never the shim itself."*

**Where the 4 resolvers disagreed:** No real disagreement on placement — all four put the command in Phase
09 with Phase 16 as backend. The only material variance was the proposed aggregation mechanism (see Gap 1):
one resolver's approach implied new `16→11`/`16→12` dependency edges the graph doesn't have. The implemented
"extensible registry, register-when-built, no new edge" framing (verbatim in Phase 09) avoids that problem.

---

## Gap 3 — `packages/engine-core` and `renderer-core` are unscaffolded

**Gap statement:** Phase 03 refers to "new `packages/engine-core`," but Phase 01's workspace enumeration
only ever listed 17 packages and never included it, making Phase 01's "all packages compile empty" exit
criterion false the moment Phase 03 lands. Separately, `renderer-core` is referenced as if it might be its
own package, with no phase scaffolding it as one.

**Ruling:** `packages/engine-core` is the **18th** scaffolded-empty workspace package, created by Phase 01
alongside the other 17 (exit criterion: "All 18 packages compile empty"). Phase 03 is its first real
implementation; Phase 03's own text no longer calls it "new" — it now reads "scaffolded empty by 01 — Gap 3."
`renderer-core` is **not** a 19th workspace package — it is a module living inside `packages/contracts`
(Phase 02 work item 6), and was never added to Phase 01's package list.

**Phases affected:** 01, 02, 03

**Verified in:**
- `01-repo-bootstrap.md` §In scope, line 16 — 18-package workspace enumeration including
  `packages/engine-core`, tagged "(Gap 3)"; §Exit criteria, line 76 — *"All 18 packages (Gap 3) — the 17
  originally enumerated plus `packages/engine-core` — compile empty"*; §Out of scope, line 29 —
  *"`renderer-core` — a module living inside `packages/contracts`, not a 19th workspace package (Gap 3)."*
- `02-contracts-and-schemas.md` §In scope — *"`renderer-core` module, inside `packages/contracts` (not a
  standalone package)"*; work item 6.
- `03-envelope-compiler-engine-adapter.md` §In scope, line 16 — *"`packages/engine-core`, scaffolded empty by
  01 — Gap 3; this phase is its first implementation"*; §Interfaces produced, line 38 — *"scaffolded empty
  by 01; first populated here — Gap 3, header no longer says 'new.'"*
- `23-release-hardening.md` header, "Primary package" row, line 8 — *"cross-cutting over all 18 workspace
  packages (Gap 3: `engine-core` counted, `renderer-core` is a `packages/contracts` module, not a 19th
  package)."*

**Where the 4 resolvers disagreed:** Broad consensus on both halves. The only split: two of the four
resolvers explicitly called for editing Phase 03's own header/text to drop the word "new"; the other two
proposed edits only to Phase 01/02 and were silent on Phase 03. Phase 03 was in fact edited (it says so
directly — "header no longer says 'new'"), matching the two who included that edit.

---

## Gap 4 — `parked:rate_limit` is missing from the Phase 02 run-lifecycle state machine

**Gap statement:** Adaptation §5.6 requires a rate-limit "parked" state, but Phase 02's 8-state, 3-terminal
Run-lifecycle enum had no such member, and the roadmap never said where it belonged.

**Ruling:** `parked:rate_limit` is **not** a Run-lifecycle state. It is a member of a new, standalone, closed
union — `WorkUnitAttemptStatus` — orthogonal to the Run lifecycle: `pending | dispatched | succeeded | failed
| cancelled | parked:rate_limit`, with its own exhaustive transition-table tests. `parked:rate_limit`
transitions only to/from `dispatched`. A Run legitimately stays `running` while one of its member WorkUnits
parks; the 8-state/3-terminal Run-lifecycle enum is completely unchanged. Four members (`dispatched`,
`succeeded`, `failed`, `parked:rate_limit`) are resolution-mandated; the remaining two (`pending`,
`cancelled`) were left to Phase 02's own discretion and were in fact added.

**Phases affected:** 02, 03, 04, 05, 06, 08, 09, 13, 14, 15, 22, 23 — every phase that declares, records,
consumes, or cross-references `WorkUnitAttemptStatus` (05 is the runtime recorder; 06 *emits* the `limitSignal`
that **13** maps to `parked:rate_limit` — 13 owns that parking transition; 08/14/15/22/23 consume it; 03
references the member in an out-of-scope mapping disclaimer — expanded 2026-07-15 after an audit found the
prior set (02, 04, 09, 13) omitted the real writers/consumers)

**Verified in:**
- `02-contracts-and-schemas.md` §In scope — *"`WorkUnitAttemptStatus` (new — orthogonal to the run
  lifecycle…): `pending | dispatched | succeeded | failed | cancelled | parked:rate_limit`"*; §Risks & open
  questions — *"membership beyond the four resolution-mandated members (`dispatched`, `succeeded`, `failed`,
  `parked:rate_limit`) is this phase's own discretionary choice (`pending`, `cancelled`) per the binding
  resolution's explicit delegation."*
- `04-journal-idempotency-leases.md` §In scope "Work-unit attempt tracking"; §Interfaces consumed table,
  `WorkUnitAttemptStatus` row.
- `09-cli-and-doctor.md` §Interfaces consumed — cites `WorkUnitAttemptStatus` (incl. `parked:rate_limit`, and
  `cancelled`) for `status --watch` rendering.
- `13-scheduler-packets-context.md` §In scope "Limit parking" and §Risks & open questions, line 93 —
  *"`WorkUnitAttemptStatus: parked:rate_limit`, session retained — only reachable from, and returning to,
  `dispatched`"* / *"`cancelled` as the anticipated member per Gap 4's own text."*
- `23-release-hardening.md` §In scope — *"limit-parked resume (`WorkUnitAttemptStatus: parked:rate_limit`)
  surviving a supervisor restart."*

**Where the 4 resolvers disagreed:** All four agreed on the shape (a separate union, orthogonal to Run
lifecycle) but proposed different names and member lists. One resolver used a **different type name**
(`WorkUnit.attemptStatus`, a field-level type rather than a named enum) with 5 members and no `pending`; the
other three used `WorkUnitAttemptStatus` with varying minimal lists (4–5 members). The shipped 6-member
union, and its explicit "4 mandated + discretionary rest" framing, matches the resolver who wrote it that
way — not the one who invented a different type name, and not the ones who omitted `pending`/`cancelled`
from consideration.

---

## Gap 5 — No journal entry-type enum is ever named

**Gap statement:** Phase 02's own exit criterion promised "every transition has a journal-entry type," but no
closed union was ever named — only prose scattered across Phases 07/08/09/13/18/21/22.

**Ruling:** `JournalEntryType` is a closed, **13-member** discriminated union owned by Phase 02, alongside
(never merged into) the Run-lifecycle and `WorkUnitAttemptStatus` unions: `run_transition,
work_unit_transition, adjudication_decision, remote_operation_record, evidence_pointer, session_assignment,
git_freeze, worktree_quarantine, cas_ref_update, approval_token_mint, fanout_rationale, milestone_sync,
learning_transition`. Rate-limit-park events are `work_unit_transition` entries (their status field carries
`WorkUnitAttemptStatus`) — **there is no separate `rate_limit_park` member.** The union is closed at exactly
13; a 14th member requires a new coordinated resolution round, not a unilateral addition. (Phase 12 has
flagged, but not resolved, that capability-audit pass/fail decisions have no clean dedicated member — this
tension is explicitly left open and is *not* grounds to add a 14th member unilaterally; Phase 14 makes the
identical choice for its own gate/flake evidence, citing this same closed-at-13 decision.)

**Phases affected:** 02, 04, 05, 06, 07, 08, 09, 11, 12, 13, 14, 16, 18, 21, 22, 23 — every phase that writes
or consumes a `JournalEntryType` member (07 is the sole writer of `git_freeze`/`worktree_quarantine`, 16 of
`remote_operation_record`, 18/21 of `milestone_sync`, 09/11/12/22 of `approval_token_mint` — the union of all member writers/consumers,
broader than Phase 02's own prose note at 02:73, which is itself under-inclusive (02:73 omits 11/14/16 and
attributes `approval_token_mint` to 09/12 only) — expanded 2026-07-15 after an audit found the prior set (02,
04, 08, 13, 14, 22) omitted the actual writers)

**Verified in:**
- `02-contracts-and-schemas.md` §In scope — the 13-member list verbatim; §Exit criteria — exhaustiveness
  check; §Risks & open questions — closed-at-13 statement, and the Phase-12 tension noted as out of this
  phase's authority to resolve unilaterally.
- `04-journal-idempotency-leases.md` §In scope, §Interfaces consumed table, §Work items 1, §Exit criteria —
  all type against the identical 13-member list, verbatim.
- `08-integration-publication.md` (journals `cas_ref_update`/`evidence_pointer`), `13-scheduler-packets-
  context.md` (`fanout_rationale`/`work_unit_transition`), `14-quality-security-gates.md` (`evidence_pointer`,
  line 87 — *"Gap 5's own rationale rejected a 14th"*), `22-learning-system.md` (`learning_transition`) —
  each journals against specific named members drawn from the same closed list, none inventing an additional
  member.

**Where the 4 resolvers disagreed:** Three of the four converged on an identical, correctly-counted 13-member
list — the one shipped, verbatim. The fourth resolver's proposed list actually contained **14 distinct
tokens while claiming "13 members"** — it kept `rate_limit_park` as a separate member *in addition to*
`work_unit_transition`, and used different suffixes throughout (`session_id_assignment`, `git_freeze_record`,
`approval_token_minted`, `milestone_sync_event`). That miscounted list was rejected; one of the other three
resolvers explicitly caught and named the arithmetic error.

---

## Gap 6 — PR/review-comment artifacts are rendered with no delivery mechanism

**Gap statement:** Phase 17 renders PR title/body and review-comment text, and Phase 02 sets length limits
for them, but nothing in the roadmap ever calls a VCS-host API, and no phase said how a human would retrieve
this rendered text.

**Ruling:** PR-title, PR-body, and review-comment are **permanent, terminal, human-facing handoff copy** —
never delivered anywhere by the orchestrator itself. **No VCS-host (GitHub/GitLab/Bitbucket) connector exists
or will ever be added**; `packages/renderer` carries no HTTP-client or VCS-host SDK dependency, enforced by a
static manifest-check exit criterion. Phase 08 renders `pr_title`/`pr_body`/`review_comment` through Phase
17's `renderWithRegeneration()`, wraps each lint-passed `RenderedArtifact` in an `EvidenceRecord`, and journals
an `evidence_pointer` entry against the ChangeSet; a human retrieves them via Phase 09's
`evidence <change-set-id>` command — **there is no other delivery path.** `review_comment` is explicitly
**not** wired into Phase 13/14's gate-failure/repair-dispatch pipeline (that evidentiary requirement stays
journal-checked only, never rendered/lint-passed text) — this connection was proposed and explicitly
rejected. Phase 02's `CommunicationPolicy` gained a `review comment ≤6 lines (one finding, evidence, action)`
constant and a PR-title (`≤72 chars`, same convention as the commit subject) template, and **dropped** the
`dashboard version message ≤160` constant entirely — Grafana's "dashboard version" is only ever a REST
precondition/ETag token, never rendered communication text.

**Phases affected:** 02, 08, 09, 14, 17 (20 and 23 additionally confirm)

**Verified in:**
- `02-contracts-and-schemas.md` §In scope, CommunicationPolicy bullet — includes "review comment ≤6 lines
  (one finding, evidence, action)"; no dashboard-version entry anywhere; §Exit criteria — "contains no
  dashboard-version-message entry."
- `08-integration-publication.md` §Goal, §In scope "Evidence attachment (Gap 6)," line 20, §Out of scope,
  lines 26–27 — *"Tying `review_comment` evidence to 13/14's gate-failure/repair-dispatch pipeline —
  rejected by Gap 6's resolution."*
- `09-cli-and-doctor.md` §In scope, `evidence <change-set-id>` bullet — *"including rendered PR-title/PR-body/
  review-comment `RenderedArtifact`s (17) once attached… the human-facing handoff copy is retrieved here,
  never auto-posted anywhere."*
- `14-quality-security-gates.md` §Risks & open questions, line 91 — *"Gap 6, confirmed no-op for this phase:
  the binding resolutions explicitly rejected tying this phase's repair-dispatch 'new diagnostic evidence'
  requirement to 17's rendered/lint-passed review-comment template… This file introduces no relationship to
  `packages/renderer` (17)."*
- `17-renderer-communication-lint.md` §Goal, §Templates (PR title added), §Out of scope — *"`review_comment`
  groups with `pr_title`/`pr_body` under 08 for this purpose — it is not tied to 13/14's gate-failure/
  repair-dispatch pipeline"*; §Exit criteria — no-HTTP-dependency manifest check.
- `20-grafana-adapters.md` §In scope "Mutation safety," line 20 — *"the deleted `dashboard version message
  ≤160` CommunicationPolicy constant (Gap 6) never applied to this phase; this line confirms that deletion's
  rationale."*
- `23-release-hardening.md` §Interfaces consumed rows "09" and "17"; §Exit criteria, line 132 — *"never an
  opened PR (Gap 6, by design)."*

**Where the 4 resolvers disagreed:** One resolver proposed explicitly wiring `review_comment` evidence into
Phase 14's gate-failure/repair-attempt-dispatch pipeline as its consumer. This was considered and rejected —
Phase 08, 14, and 17 all now state the rejection in their own text, citing "Gap 6" by name. All four resolvers
agreed on the rest (add the review-comment constant, delete the dashboard-version constant, add a PR-title
template, no VCS connector, ever).

---

## Gap 7 — `EngineAdapter.capabilities()` field-name mismatch

**Gap statement:** Phase 03's draft named the capability tuple's two boolean fields `structuredOutput`/
`sessionResume`; the adaptation doc's own prose names them `supportsJsonSchema`/`supportsSessionResume`.

**Ruling:** The adaptation doc's names win: `capabilities()` returns exactly `supportsJsonSchema,
supportsSessionResume, permissionModel, sandboxModel, engineVersion`. Phase 03's earlier `structuredOutput`/
`sessionResume` are retired and must never be reintroduced.

**Phases affected:** 03, 06 (11 and 23 cite the resulting names; 06 returns the fields from its EngineAdapter
implementation at 06:42/116 — 06 added 2026-07-15)

**Verified in:**
- `03-envelope-compiler-engine-adapter.md` §In scope, `EngineAdapter` interface bullet, line 16 — *"returning
  exactly `supportsJsonSchema`, `supportsSessionResume`, `permissionModel`, `sandboxModel`, `engineVersion`
  (Gap 7 — retires this phase's earlier `structuredOutput`/`sessionResume` draft names)"*; §Exit criteria,
  line 91 — same five fields, "(Gap 7)."
- `11-intake-contract-approval.md` §Interfaces consumed, line 96 — *"`EngineAdapter.capabilities()` —
  `engineVersion`, `supportsJsonSchema`, `supportsSessionResume` (field names per Gap 7)."*
- `23-release-hardening.md` §Interfaces consumed, row "03," line 63 — the same five field names listed
  verbatim.
- `06-claude-engine-adapter.md` §Interfaces produced / Risks, lines 42 and 116 — names
  `supportsJsonSchema`/`supportsSessionResume` explicitly, each tagged "(field names per Gap 7)"; consistent
  with this ruling, with no conflicting draft names to retire there. (An earlier version of this bullet
  claimed 06 "does not name these fields anywhere"; that was factually wrong and is corrected here —
  2026-07-15 audit.)

**Where the 4 resolvers disagreed:** One of the four dissented on naming, arguing Phase 03's own
`structuredOutput`/`sessionResume` should win because "the adaptation doc is upstream research prose, not
literal code" — rejected; the shipped ruling adopts the adaptation doc's names instead. A different resolver,
who agreed with the winning `supportsJsonSchema`/`supportsSessionResume` naming, separately noted Phase 06
also references these fields — correct: Phase 06 names them at lines 42/116 ("field names per Gap 7"),
already consistent with the winning names, so nothing there needed retiring (this sentence corrected
2026-07-15; the earlier claim that 06 "never names these fields at all" was wrong).

---

## Gap 8 — `result.submit` vs `result_submit`

**Gap statement:** Adaptation §5.3's inline SDK code sample writes `tool("result_submit", …)` (underscore);
the same doc's prose (§4.4, §5.5) and every other fully-specified tool family in the roadmap use a dotted
`family.leaf` convention.

**Ruling:** The wire name is `result.submit` (dot form). `result_submit` is an illustrative-shorthand erratum
in the adaptation doc's own code sample and must never be back-ported.

**Phases affected:** 02, 06, 16

**Verified in:**
- `02-contracts-and-schemas.md` §Out of scope — lists `result.submit` (dotted) among the MCP tool
  implementations owned by 16/11/12.
- `06-claude-engine-adapter.md` §In scope, "Results" bullet, line 19 — *"gateway `result.submit` retained as
  belt-and-suspenders (dotted form, Gap 8 — unchanged)"*; §Out of scope, line 30 — same dotted spelling.
- `23-release-hardening.md` §Interfaces consumed, row "16" — `result.submit` listed among Phase 16's tool
  surface.
- `16-gateway-core.md` now lists `result.submit` explicitly, dotted — §Goal and §In scope, "Sole MCP host &
  extensible tool-registration API" bullet, both name it verbatim alongside `evidence.get`/`evidence.attach`;
  §Exit criteria repeats it in the `gateway mcp` tool-listing check; the naming convention itself is already
  settled and cross-referenced by Phase 02/06/23.

**Where the 4 resolvers disagreed:** Unanimous on the dot form winning — no substantive disagreement. The
only variance was bookkeeping (whether Phase 16's text needed an explicit edit adding `result.submit`/
`evidence.attach` to its tool-surface bullet, versus treating it as implied by Gap 1's broader fix) — not a
conflicting decision.

---

## Gap 9 — Phase 12 → Phase 13 consumption claim contradicts the dependency graph

**Gap statement:** Phase 12's work item 2 said its doc-research task-packet generator is "consumed by
manager subagents in 13," but Phase 13 never depends on Phase 12 (README graph has no `P12→P13` edge; Phase
13's own dependencies are 06/07/11 only), and "manager subagents" is Phase 10/11's vocabulary, never Phase
13's.

**Ruling:** Phase 12's doc-research task-packet generator is consumed by **Phase 11's** manager-session
contract/DAG drafting flow, not by Phase 13. The original text was a factual error in Phase 12's own file;
Phase 12's own header already said "enriches 11." No companion edit to Phase 11 was needed — its existing
"12 detection when available; graceful degradation before 12" language already covers the relationship.

**Phases affected:** 11, 12, 13 (13 carries three `(Gap 9)` disclaimers and is cited three times in this
gap's Verified-in — 13 added 2026-07-15)

**Verified in:**
- `12-stack-detection-quarantine.md` §Interfaces produced and §Work items 2 — *"Doc-research task-packet
  generator — consumed by phase 11's manager-session contract/DAG drafting flow (see 11 work item 2) when
  available; graceful degradation before 12, mirroring 11's existing stack-detection relationship."*
- `11-intake-contract-approval.md` §In scope, `project.inspect` bullet — "12 detection when available;
  graceful degradation before 12" (pre-existing text, left unedited, and cited by Phase 12 as sufficient
  corroboration).
- `13-scheduler-packets-context.md` §Out of scope, line 38 — *"Doc-research task-packet generation (12) —
  consumed by 11's drafting flow, never directly by this phase (Gap 9)"*; §In scope, line 21 and §Out of
  scope line 32 also cite "(Gap 9)" directly for the related "manager subagents are never this phase's
  vocabulary" clarification.

**Where the 4 resolvers disagreed:** Near-unanimous on the core fix (redirect the citation from 13 to 11); one
resolver additionally edited Phase 11 to add a corroborating clause, the other three held Phase 11's existing
text was already sufficient and left it alone. Phase 11 was in fact left unedited, and Phase 12's shipped
wording is a near-verbatim match to the wording proposed by the resolver who argued no Phase 11 edit was
needed.

---

## Gap 10 — Capability-flag label drift

**Gap statement:** Phase 02's canonical 11-member `HighImpactCapabilityFlag` enum uses `closing transitions`/
`bulk mutations`; Phase 18 (Jira) independently used `Done/Closed transitions`/`bulk`.

**Ruling:** Phase 02's labels win verbatim, everywhere: `closing transitions`, `bulk mutations` (and the
other 9 members unchanged). A connector may still gloss a label in surrounding prose (e.g. "closing
transitions (Jira Done/Closed workflow statuses)"), but the label token itself must be byte-identical to
Phase 02's — never independently restated.

**Phases affected:** 02, 11, 18 (19, 20, 23 confirm) — 11 consumes the canonical labels verbatim in its
approval-preview surface (11:32–33); 11 added 2026-07-15

**Verified in:**
- `02-contracts-and-schemas.md` §In scope — `HighImpactCapabilityFlag` 11-member list, including "closing
  transitions" and "bulk mutations" verbatim; §Exit criteria — "label strings byte-match what 18/20 cite."
- `18-jira-cloud-adapter.md` §In scope, "High-impact capabilities," line 18 — *"byte-identical labels…
  `closing transitions` (Jira Done/Closed workflow statuses)… `bulk mutations` (multi-issue bulk edit/
  transition)."*
- `20-grafana-adapters.md` §In scope, line 19 — *"using 02's `HighImpactCapabilityFlag` labels verbatim
  (Grafana's 4 members never drifted from 02's wording, unlike Jira's, which Gap 10 corrects)."*
- `19-jira-datacenter-adapter.md` §Interfaces consumed, line 57 — "P02's canonical labels (`closing
  transitions`, `bulk mutations`, among others)."
- `23-release-hardening.md` §Interfaces consumed, row "18," line 78 — "canonical P02 labels: closing
  transitions, bulk mutations, etc."

**Where the 4 resolvers disagreed:** No disagreement — unanimous across all four that Phase 02's labels win
and Phase 18 alone needed the edit.

---

## Gap 11 — `crabgic_gateway` / `mcp__crabgic_gateway__*` literal names never echoed in the roadmap

**Gap statement:** The adaptation doc asserts these as settled, verified identifiers (§2 row 11, Appendix B),
but no roadmap phase's own text ever wrote the literal string — three different phases (06, 10, 16) need to
agree on it byte-for-byte for `--strict-mcp-config` to resolve correctly.

**Ruling:** The server name is pinned as a single named constant, `GATEWAY_MCP_SERVER_NAME = "crabgic_gateway"`,
exported from `packages/contracts` (Phase 02) — **not** independently hand-typed as a literal string in each
consuming phase. Every consumer imports the constant: Phase 03's compiler derives the mandatory
`mcp__${GATEWAY_MCP_SERVER_NAME}__*` permission-allow entry from it; Phase 06's `mcpServers` key and
`strictMcpConfig` allowlist reference it (with a dedicated test asserting zero hand-typed `"crabgic_gateway"`
literals anywhere in `packages/engine-claude`); Phase 10's `.mcp.json` entry key is golden-tested against it;
Phase 16 registers its SDK MCP server under it and derives the `mcp__${GATEWAY_MCP_SERVER_NAME}__<tool>`
wire-prefix from it (pending — see below). Phase 02 enforces itself as the sole definition site with a
repo-wide grep/golden-value CI check.

**Phases affected:** 02, 03, 06, 09, 10, 11, 12, 16, 23 — 11/12 import the constant for tool-registry
registration (11:68, 12:43) and 23 release-gates it; 11/12/23 added 2026-07-15

**Verified in:**
- `02-contracts-and-schemas.md` §In scope — *"`GATEWAY_MCP_SERVER_NAME` constant: `"crabgic_gateway"` — the single
  literal every engine-side MCP registration derives from… no phase hand-types the literal a second time"*;
  §Exit criteria — "a repo-wide grep/golden-value CI check fails if the literal appears a second time under
  `packages/*`."
- `03-envelope-compiler-engine-adapter.md` §In scope, line 18 — *"the mandatory
  `mcp__${GATEWAY_MCP_SERVER_NAME}__*` allow entry is derived programmatically from `GATEWAY_MCP_SERVER_NAME`
  (constant, 02…), never hand-typed a fourth literal (Gap 11)."*
- `06-claude-engine-adapter.md` §In scope "Gateway wiring (Gap 11, Gap 2)," line 17; §Exit criteria, line
  101 — "zero hand-typed `"crabgic_gateway"` literals anywhere in `packages/engine-claude` — `gateway-name-
  reference.test`."
- `09-cli-and-doctor.md` §Interfaces consumed, line 129 — *"`GATEWAY_MCP_SERVER_NAME = "crabgic_gateway"` —
  `gateway mcp`'s server identity."*
- `10-plugin-and-installer.md` §In scope — ".mcp.json entry keyed `GATEWAY_MCP_SERVER_NAME`"; §Work items 2 —
  golden-file test against the constant.
- `11-intake-contract-approval.md` §Interfaces consumed, line 68 — *"`GATEWAY_MCP_SERVER_NAME = "crabgic_gateway"`,
  constant owned by 02 — Gap 11"*; imports the constant to register `project.inspect`/`contract.approve` into
  the shared tool registry (Gap 1).
- `12-stack-detection-quarantine.md` §Interfaces consumed, line 43 — *"`GATEWAY_MCP_SERVER_NAME` constant
  (`"crabgic_gateway"`)"* used for its `capability.audit`/`capability.approve` tool-registry registration.
- `23-release-hardening.md` §Interfaces consumed, row "02," line 62 — lists `GATEWAY_MCP_SERVER_NAME` among
  the release-gated contracts.
- `16-gateway-core.md` now references the constant explicitly — §In scope names `GATEWAY_MCP_SERVER_NAME`
  directly ("this phase hosts the one `crabgic_gateway` MCP server (`GATEWAY_MCP_SERVER_NAME`, constant owned by
  02)"); §Interfaces consumed states *"this phase's SDK server registration and every wire-level
  `mcp__${GATEWAY_MCP_SERVER_NAME}__<tool>` name derive from this; never a second hand-typed literal"* —
  matching every *other* phase's description of what Phase 16 does with it.

**Where the 4 resolvers disagreed:** A real conflict. Two resolvers proposed hand-typing the literal
`"crabgic_gateway"` independently into Phase 16/10/03's own prose (no shared constant, just matching strings by
convention). The other two proposed the shared named-constant approach actually shipped. The hand-typed
approach is rejected — Phase 02 owns the constant and every consumer imports it; the exit criteria in Phase
02/06 (the grep check; the zero-hand-typed-literal test) exist specifically to prevent the rejected approach
from silently creeping back in.

---

## Gap 12 — Permission-rule syntax drift from the cited baseline

**Gap statement:** Phase 03's draft used an invented hybrid `Bash(cmd :*)` (space before colon), which
matches neither of the adaptation doc's two confirmed forms (the four `Bash(...):*`-suffixed literals with no
space, and the unrelated bare-word-boundary `Bash(ls *)`, which has no colon at all).

**Ruling:** The envelope compiler's command-prefix rules use exactly the adaptation doc's four confirmed
literal forms, **no space before the colon**: `Bash(npm run test:*)`, `Bash(npm run build:*)`,
`Bash(git status:*)`, `Bash(git diff:*)`. Phase 03's invented hybrid form is retired and must never reappear;
the unrelated word-boundary rule must never be cited to justify a third, unverified colon-spacing notation.
Whether `Bash(<prefix>:*)` requires or forbids a space for any prefix **beyond** those four literals is an
open, explicitly-tracked question: Phase 00 runs a dedicated probe and records the verdict in
`docs/engine-baseline.md` before Phase 03's compiler may generalize the pattern to any wider prefix.

**Phases affected:** 00, 03

**Verified in:**
- `00-engine-spikes.md` §In scope "Permission probes," line 18 — *"whether `Bash(<prefix>:*)` requires or
  forbids a space before the colon for a command prefix outside those examples. Record that verdict in
  `docs/engine-baseline.md` before phase 03's compiler is allowed to generalize the pattern to any prefix
  this probe didn't cover"*; §Work items 4; §Risks & open questions, final bullet.
- `03-envelope-compiler-engine-adapter.md` §In scope, "Envelope compiler" bullet, line 18 — the four literals
  quoted verbatim, *"no space before the colon, per adaptation Appendix B; the word-boundary rule… is a
  separate mechanism, not stretched to justify a third, unverified colon-spacing notation (Gap 12)"*; §Risks
  & open questions, line 101 — the identical constraint restated as a build-blocking condition on
  generalization.

**Where the 4 resolvers disagreed:** No material disagreement — all four independently proposed the identical
fix (the four literals, no space, plus a Phase 00 probe for anything wider). Only cosmetic wording
differences between the four proposals.

---

## Gap 13 — (Minor) Phase 03's Sources field never cites `docs/engine-baseline.md`

**Gap statement:** Phase 03 depends on Phase 00 and is engine-touching, but its header "Sources" row never
cited the baseline doc the README's own ground rule requires ("anything engine-touching cites
`docs/engine-baseline.md`… never memory").

**Ruling:** Phase 03's header "Sources" row cites `docs/engine-baseline.md (phase 00 output)`, matching
Phase 06's pre-existing citation pattern for the identical reason.

**Phases affected:** 03 (citing 00)

**Verified in:**
- `03-envelope-compiler-engine-adapter.md` header table, "Sources" row, line 7 — *"adaptation §1
  (EngineAdapter), §4.1–§4.2, §5.1, §9 (envelope-conformance test-matrix), Appendix B (`mcp__*` deny footgun);
  `docs/engine-baseline.md` (phase 00 output)."*

**Where the 4 resolvers disagreed:** No disagreement — unanimous on adding the citation; only cosmetic
differences in the exact parenthetical wording (two resolvers' proposed wording is the exact string shipped;
two others proposed slightly different phrasing that did not ship).

---

## Gap 14 — (Minor) Two independent "XDG cache" usages with no shared pinned path constant

**Gap statement:** Phase 07 (control clone) and Phase 12 (capability store) each independently said "XDG
cache" with no shared literal path, risking the two landing in different directories in practice.

**Ruling:** The shared cache-root constant is pinned exactly **once**, in Phase 04 (`packages/journal`), as
the sibling of Phase 04's existing `$XDG_STATE_HOME` state-root bullet:
`$XDG_CACHE_HOME/crabgic/<project-hash>/`. Phase 07's control clone nests at
`.../git-control/`; Phase 12's capability store nests at `.../capability-store/`. Phase 07 and Phase 12 cite
Phase 04's constant rather than independently inventing "XDG cache" phrasing or a differing path-segment
order.

**Phases affected:** 04, 05, 07, 08, 12, 14, 23 — 04 pins the cache-root constant, 07/12 nest under it,
08/14/23 embed the `$XDG_CACHE_HOME/crabgic/<project-hash>/…` subpath convention
(08:21/59, 14:48, 23:67), and 05 embeds the same pinned convention via its `$XDG_STATE_HOME/…` state-root
sibling (05:24) — expanded 2026-07-15 (same under-coverage class as Gaps 4/5/10/11)

**Verified in:**
- `04-journal-idempotency-leases.md` §In scope, "Layout" bullet, line 22 — *"`$XDG_CACHE_HOME/engineering-
  orchestrator/<project-hash>/` — cache root, pinned here as a sibling constant (Gap 14): 07's control clone
  nests at `.../git-control/`, 12's capability store nests at `.../capability-store/`. 04 pins the shared
  root; 07/12 own writing under it"*; §Interfaces produced, line 47 — same constant as an exported layout
  constant; §Exit criteria — "`$XDG_STATE_HOME`/`$XDG_CACHE_HOME` crabgic roots are defined
  exactly once in this package."
- `07-git-control-repo-worktrees.md` §In scope, "Control clone," line 17 — "into
  `$XDG_CACHE_HOME/crabgic/<project-hash>/git-control/` (cache-root convention pinned in
  04)"; §Interfaces produced, line 39, and §Exit criteria, line 80 — the same path repeated as a
  path-convention test.
- `12-stack-detection-quarantine.md` §In scope, line 21 — "Content-addressed capability store under
  `$XDG_CACHE_HOME/crabgic/<project-hash>/capability-store/` (same convention, pinned in
  04)."
- `23-release-hardening.md` §Interfaces consumed, row "07," line 67 — cites the identical path.

**Where the 4 resolvers disagreed:** Two conflicts, both real. **(1) Who pins it:** three resolvers said
Phase 04 should own the constant (mirroring its existing `$XDG_STATE_HOME` bullet); one said Phase 07 should
own it instead. The shipped design pins it in Phase 04. **(2) Path-segment order:** proposals varied between
`<project-hash>/git-control/`, `git-control/<project-hash>/`, and a differently-named
`git-clones/<project-hash>/`. The shipped order is `<project-hash>/git-control/`. Phase 04's own text (§Risks
& open questions, final bullet) flags this explicitly as reconciling "an internal inconsistency between two
passages of the binding resolutions doc's own Gap-14 text" and confirms it followed "the literal,
twice-repeated form" — i.e. the path order recorded in this ledger entry is the one actually cross-checked
against, and matching, both Phase 07's and Phase 12's own committed text.

---

## Gap 15 — (Minor) `engine-live` CI job name and `@live` test tag never explicitly linked

**Gap statement:** Phase 01 places an inert, manually-triggered `engine-live` CI job placeholder and says it
is "wired in phase 06," while Phase 06 correctly names the `@live` tag — but no single sentence ever tied the
two names together explicitly.

**Ruling:** Phase 01's CI bullet states the placeholder job by name and states that Phase 06 wires it to run
the `@live`-tagged conformance suite; Phase 06's own work item performs that wiring. Both phases now name the
link explicitly.

**Phases affected:** 01, 06

**Verified in:**
- `01-repo-bootstrap.md` §In scope, line 22 — *"a manually-triggered `engine-live` job placeholder that phase
  06 wires to run the `@live`-tagged conformance suite (needs a host with `claude`) (Gap 15)"*; §Interfaces
  produced, line 44, and §Exit criteria, line 83 repeat the identical link.
- `06-claude-engine-adapter.md` §In scope, "`@live` conformance," line 23 — *"wire the `engine-live` CI job
  (inert placeholder from 01, Gap 15) to run the `@live`-tagged suite"*; §Work items 6.
- `23-release-hardening.md` §Out of scope, line 40 — *"The `engine-live` CI job's existence and its
  `@live`-tag wiring — created in 01, wired to the tagged suite in 06 (Gap 15)."*

**Where the 4 resolvers disagreed:** Three resolvers proposed editing Phase 01's CI bullet; one proposed
editing Phase 06's work item instead. Both edits are in fact present in the shipped files (Phase 01 carries
the explicit "(Gap 15)" tag; Phase 06's work item 6 independently performs the wiring) — this was resolved
by doing both, not by picking one over the other.

---

## Gap 16 — Phase-23 CI-produced evidence records have no pinned path, env or failure convention

**Gap statement:** Phase 23's release gate consumes evidence that is **produced outside the checkout it is
scoring** — a CI job on hardware the release cut does not have, or a benchmark harness whose run is not the
release run. Three such records are now **consumed** (`arm64-run-record.json`, produced by `ci.yml`'s ARM64
matrix leg and downloaded by `release-e2e.yml`; `perf-contract-rerun.json`, produced by 15's twin-worktree
A/B runner; `requirement-traceability.json`, produced by 23's containerized Grafana binding through 21's
`bindRemoteResourceEvidence` writer) — the first two do not sit in the tree, which is the point of the ruling
rather than an oversight: they are produced outside the checkout being scored. Nothing in the roadmap or in this ledger says
where such a record lives, how the CI-ingest override that carries it is named, or what a check must do when
the record it finds is malformed. `roadmap/23-release-hardening.md` did not mention `docs/evidence/` at all —
zero hits across the file, until the coordinated edit recorded below — so the directory, the `CRABGIC_*` variable
names and the read-failure behaviour were each being decided independently, per check, by whoever wrote the
check. When this gap was identified the two
existing consumers diverged in a small but real way (blank-string handling of the override — since
reconciled, see "Verified in" below), and sibling in-tree record readers diverged in a large one (see "Known
non-conformance" below).

**Ruling:** A phase-23 evidence record that a release-gate check *consumes* — as opposed to one the check
produces itself — follows one convention, in three parts:

1. **Path.** The record is looked for at `docs/evidence/phase-23/<record-name>.json`, relative to the
   repository root the check was handed. `<record-name>` is `kebab-case` and names the thing recorded, not
   the check reading it (`arm64-run-record`, `perf-contract-rerun`). This is the *committed-artifact* seam
   and is deliberately distinct from Gap 14's runtime
   `$XDG_CACHE_HOME/crabgic/<project-hash>/…` cache convention: Gap 14 governs machine-local
   state a running orchestrator writes, Gap 16 governs release evidence that is read as part of scoring a
   frozen release candidate. Neither ruling constrains the other.
2. **Environment override.** Each record declares exactly one override variable, named `CRABGIC_` +
   `SCREAMING_SNAKE_CASE` of the record's own subject (`CRABGIC_ARM64_RUN_RECORD`,
   `CRABGIC_PERF_CONTRACT_RERUN_RECORD`, `CRABGIC_REQUIREMENT_TRACEABILITY_RECORD`), holding an **absolute path to the record file** — not a directory, not
   the record's contents. The override wins when set to a non-blank value; unset or blank falls back to the
   in-repo path. The override is the primary path in CI, and the reason is structural rather than
   convenience: these records name the release-candidate object ID they were taken against, and *committing*
   a downloaded record advances `HEAD` past that very object ID, so "record is in the tree" and "record
   matches the candidate" are unsatisfiable together. CI therefore downloads the artifact **outside the
   checkout** (`$RUNNER_TEMP`) and exports the variable; the in-repo path remains for the case it is honestly
   good for — a record archived alongside the release for post-hoc audit.
3. **Schema, and what a bad record does.** Each record has a `zod` schema declared next to its path constant
   and named `<Subject>RecordSchema`; the schema is `.strict()`, so producer drift is surfaced rather than
   silently half-read. The reader validates with **`safeParse`, never `parse`**, and **never throws**: an
   absent, unparseable or schema-violating record is reported as a **FAIL of that one checklist item, with
   the offending path and the schema issues quoted in the reason**. A `ZodError` escaping a reader would
   abort the whole attestation run and take every *other* item's evidence down with it — turning one item's
   drift into a report that evidences nothing.

**Rationale:** All three parts exist to keep a single failure honest and local. (1) pins where a reader and a
producer must agree, so the "check reads a path nothing writes" defect this round found in the ARM64 loop is
detectable by inspection rather than only by a failing gate. (2) resolves the object-ID catch-22 above, which
has no solution inside the checkout. (3) is the ground rule "exit criteria are evidence, not claims"
(`roadmap/README.md`) applied to the reader: a crash produces an *absence* of verdict, which a report
consumer cannot distinguish from an item that was never scored, whereas a FAIL with a quoted schema issue is
an instruction to whoever owns the producer. The blocking reason must also name the artifact it is reporting
the absence of, so the reason is a locator a reader can act on rather than an unfalsifiable statement.

**Phases affected:** 01, 15, 21, 23 — **01** owns the CI skeleton whose ARM64 matrix leg produces
`arm64-run-record.json` (`01-repo-bootstrap.md:22`, `:44`, `:75` — the ARM64 leg and its deferral, closed by
23); **15** owns the `PerformanceContract` decision engine and twin-worktree A/B runner whose re-run produces
`perf-contract-rerun.json` (`23-release-hardening.md:75` — "Re-run on a quiet host for the
release-candidate's real verdicts"); **21** owns `bindRemoteResourceEvidence`, the writer that produces the
`RemoteResource`/`RemoteEvidencePointer` pair inside `requirement-traceability.json`
(`21-connector-evidence-integration.md` work item 1); **23** owns `docs/evidence/phase-23/`, all three
consumers, and the `release-e2e` job that performs the ingest (`23-release-hardening.md:52`, `:61`, `:133`).
A new consumed record, a renamed variable, or a change to the read-failure behaviour is a coordinated edit
across the producer phase and 23.

**Amendment (2026-07-26) — the third consumed record.** `requirement-traceability.json` was being consumed
under this ruling's part (1) and part (3) but had **no part-(2) override**, and it is the record for which
the catch-22 part (2) exists to resolve bites hardest: the artifact names the release-candidate object ID
its containerized binding was taken against, `checkRequirementTraceability` requires that to equal the
candidate being scored, and committing a regenerated artifact advances `HEAD` past the object ID the new
artifact names. The item was therefore unclearable by construction — it reported the committed artifact as
describing "a different release candidate" at every cut. It now declares
`CRABGIC_REQUIREMENT_TRACEABILITY_RECORD` (`e2e/attestation/src/requirementTraceability.ts`), resolved with the
same `override === undefined || override.trim() === ""` fallback the other two use, and
`.github/workflows/release-e2e.yml` writes the artifact to `$RUNNER_TEMP` and exports the variable — the
producer now writes exactly where the consumer reads. Unlike the other two records this one is ALSO committed
in-tree, which remains honest under part (2)'s own words ("a record archived alongside the release for
post-hoc audit"): the committed copy is the audit trail, the override is what a live cut scores.

**Coordinated phase-file edit — performed.** The rule at the top of this file (`:20-24`) requires a path
convention and an `CRABGIC_*` variable-naming rule to be landed across every phase file listed under "Phases
affected". All three now carry it, each in its own idiom and in the section the record actually belongs to:
`roadmap/01-repo-bootstrap.md` §Interfaces produced (the CI-skeleton bullet, where the ARM64 leg's
`arm64-run-record` artifact is produced), `roadmap/15-performance-contracts.md` §Interfaces produced (a
"Release re-run record" bullet alongside the archived raw samples),
`roadmap/21-connector-evidence-integration.md` §Interfaces produced (a "Release traceability record" bullet
alongside the bound `EvidenceRecord` instances — added by the 2026-07-26 amendment below), and
`roadmap/23-release-hardening.md`
§Interfaces produced (a `docs/evidence/phase-23/<record-name>.json` bullet alongside
`e2e/release-gate-report.json`, naming all three overrides). This entry is therefore carried by the phase files as well as by the
implementing source — the stronger of the two forms this ledger recognises. It remains provisional on the
separate ground its "Origin" line states: owner ratification.

**Verified in:**
- `e2e/attestation/src/arm64Verification.ts:70-71` — `ARM64_RUN_RECORD_PATH =
  "docs/evidence/phase-23/arm64-run-record.json"`, `ARM64_RUN_RECORD_ENV = "CRABGIC_ARM64_RUN_RECORD"`; `:77-92`
  `Arm64RunRecordSchema`, `.strict()`; `:243-266` `readArm64RunRecord` — override-then-in-repo resolution,
  `safeParse`, `{ outcome: "malformed", path, problem }` rather than a throw. Two separate in-file
  rationales, cited separately because they are different paragraphs: `:43-69` explains why the override is
  the primary path in CI and the SHA catch-22 behind it, and `:228-233` explains the read-failure behaviour
  ("NEVER throws: a record it cannot read is reported as `malformed` so this one item FAILs with a reason,
  instead of a `ZodError` escaping into the release-evidence run"). **The one divergence this entry
  recorded is now closed:** the reader's blank-override test was `override.length > 0`, so an override set
  to whitespace was used as a path where `readPerformanceRerunEvidence` trims first and falls back. It is
  now `override === undefined || override.trim() === ""` (`:246`), the `trim()` form this ruling requires —
  an all-whitespace variable is an unset variable that passed through a shell, never a filename — paired
  with a test that feeds `"  \t\n "` and asserts the in-repo path is what gets resolved
  (`arm64Verification.test.ts`, "falls back to the in-repo path when the override is only whitespace";
  confirmed by mutating the `trim()` away and observing it go RED).
- `.github/workflows/ci.yml:109-129` — the producer: writes `arm64-run-record.json` and uploads it as the
  `arm64-run-record` artifact. `.github/workflows/release-e2e.yml:125-189` — the consumer-side ingest step:
  `gh run download … -n arm64-run-record` into a directory outside the checkout, then
  `echo "CRABGIC_ARM64_RUN_RECORD=$RECORD" >> "$GITHUB_ENV"`.
- `e2e/attestation/src/requirementTraceability.ts` — `TRACEABILITY_INPUT_PATH =
  "docs/evidence/phase-23/requirement-traceability.json"`, `TRACEABILITY_RECORD_ENV =
  "CRABGIC_REQUIREMENT_TRACEABILITY_RECORD"`; `readRequirementTraceabilityInput` resolves override-then-in-repo
  with the `trim()` fallback, and reads through `parseTraceabilityEvidenceFile`
  (`traceabilityEvidence.ts`), which `safeParse`s a `.strict()` schema and returns
  `{ ok: false, error }` rather than throwing — surfaced by the check as the stated reason
  "`…requirement-traceability.json` exists but is unusable: …". `requirementTraceability.test.ts`
  pins all four branches (absolute-path override honoured; blank override falls back in-repo;
  unreadable JSON reported as a FAIL reason rather than thrown; a missing override target does not
  silently fall back to the committed copy).
- `.github/workflows/release-e2e.yml` — the producer side: runs the containerized Grafana binding
  (`e2e/attestation/vitest.live.config.ts`) with `CRABGIC_REQUIREMENT_TRACEABILITY_RECORD` pointed at
  `$RUNNER_TEMP`, then exports it to `$GITHUB_ENV` for the harness step. Bound to the constant by
  `requirementTraceability.test.ts`'s "release-e2e.yml produces what this check consumes", which reads the
  real workflow file rather than a fixture. The step never fails the job: an unproduced binding is the
  honest input "no confirmed remote revision for this candidate", reported by the gate with reasons.
- `e2e/attestation/src/performanceContracts.ts:657-659` — `PERFORMANCE_RERUN_RECORD_PATH =
  "docs/evidence/phase-23/perf-contract-rerun.json"`, `PERFORMANCE_RERUN_RECORD_ENV =
  "CRABGIC_PERF_CONTRACT_RERUN_RECORD"`; `:667-688` `PerformanceRerunRecordSchema`, `.strict()`; `:713-752`
  `readPerformanceRerunEvidence` — same resolution order, `safeParse`, and a
  `PerformanceRerunEvidence` union in which "no record and no explanation why" is unrepresentable;
  `:809-814` `PERFORMANCE_CONTRACT_RERUN_UNEVIDENCED_REASON`, the blocking reason emitted while the record is
  absent.
- `e2e/attestation/src/performanceContracts.test.ts` — the branch pairs this ruling requires, each named
  rather than summarised, because an earlier version of this line claimed more than the suite pinned:
  unreadable JSON; a value-level schema violation (empty `contracts`); **part (3)'s `.strict()` on both
  schemas — an unknown top-level key and an unknown contract-entry key, one test each**; one case per
  required member with that member omitted (`releaseCandidateObjectId`, `runner`, `quietHost`, `capturedAt`,
  `contracts`) and one per string member left blank; a blank `contractId` and an `outcome` outside 02's
  `PERFORMANCE_OUTCOMES`; the blank override falling back to the in-repo path
  (asserted on the path actually resolved, not on a substring present in every message); and the
  record-present read path. Each was confirmed by mutating the source — deleting either `.strict()`, making
  any member `.optional()`, dropping any `.min(1)` — and observing the paired test go RED. Before these
  tests existed every one of those mutants survived the full suite, which is why this bullet now enumerates
  rather than summarises.

**Known non-conformance (recorded, not ruled on):** three *in-tree-only* phase-23 record **readers** declare
paths under the same directory without the parts of this convention that only apply to ingested records; two
of the three still diverge. Stated precisely, because not all three files exist: `find docs/evidence -name
'*.json'` returns `phase-06/path-anchor-determination.json`,
`phase-06/sandbox-containment-determination.json`, `phase-23/requirement-traceability.json` and
`phase-23/vendor-support-windows.json` — nothing else, so `phase-23/demo-run.json` is absent. All three
readers treat absence as a non-error and fall back (`readDemoRunRecord` returns `undefined`,
`demoBranchEvidenceHandoff.ts:158-161`; `readRequirementTraceabilityInput` leaves the binding sets empty,
`requirementTraceability.ts:235-237` and `:262-263`), so the divergence below is about what each does
with a record that IS present: `docs/evidence/phase-23/demo-run.json` (`demoBranchEvidenceHandoff.ts:30`,
`:161`) and `docs/evidence/phase-23/vendor-support-windows.json` (`versionSupportWindows.ts:38-39`, `:193`)
are schema-validated but through `.parse()`, so a malformed record throws rather than FAILing that item. The
third, `docs/evidence/phase-23/requirement-traceability.json` (`requirementTraceability.ts:59`, `:234-237`),
**no longer diverges**: it was read with an unchecked cast and no schema at all, and is now read through
`parseTraceabilityEvidenceFile` (`traceabilityEvidence.ts`) — `safeParse`, and a parse failure surfaced as
that one item's stated FAIL reason rather than a throw, i.e. part (3)'s shape. Its strictness is bounded, and
the bound is deliberate: `.strict()` holds at the top level and throughout `provenance` (including the nested
`container` and `transportSeams` blocks — four `.strict()` sites, one unknown-key test each), while the two
array-element schemas `RemoteResourceRecordSchema` and `PointerRecordSchema` are `.passthrough()` because the
committed record already carries per-element producer keys (`schemaVersion`, `canonicalUrl`) that `.strict()`
would reject, making the real artifact unreadable. The rationale is stated in-file next to both, and pinned by
a test that fails if either is tightened. So part (3)'s drift-surfacing guarantee holds for this reader down
to `provenance`, not inside `remoteResources[]`/`pointers[]`.
Part (1) of the ruling is the path all three readers already name — it does not assert that a conforming
file sits at any of them. Part (2) does not apply to in-tree-only records, which declare no override. Part
(3) is stated here as the target shape for the two remaining `.parse()` readers; bringing them into line is
a separate, scoped change and is **not** authorised by this entry.

**Origin:** This gap did **not** come from the original four-resolver round; it was identified during phase-23
release-gate remediation (2026-07-25), when the ARM64 consumer was found reading a path nothing wrote and the
second phase-23 record was added for `roadmap/23:75`'s separate performance obligation. **Owner ratification
is PENDING** — an earlier draft of this line claimed the ruling "was ratified by the owner in the same
round", and `grep -rn "ratif" docs/ roadmap/` finds no such record anywhere in this repository. Until an
owner decision exists and is cited on this line, **this entry is provisional**: it may be relied on by the
code that implements it, and it must not be cited as settled authority against a phase file the way Gaps
1-15 can be. It is a **new** ruling and contradicts no ruling above —
no existing entry names `docs/evidence/`, any `CRABGIC_*` variable, or a record-read failure mode. Gap 14 is the
only adjacent entry and governs a disjoint (runtime-cache) path space, as part (1) states explicitly.

---

## Gap 17 — The manager session has no operating protocol, and manager hooks may not block

**Origin:** Identified 2026-07-27 from **reported behavior in a consuming repo**, not from a roadmap
read-through — like Gap 16, this entry carries its own provenance rather than a four-resolver record. The
owner installed Crabgic into a real project and found the manager session (a) asking them to type "continue"
after every step of the process, and (b) when it did have a genuine question, rendering the choices as a
plain-text "option 1 / 2 / 3 / 4" list rather than using the engine's structured question tool.

**Gap statement:** Nothing in the roadmap or in this ledger said what the manager session's *operating
posture* is. The artifact that reaches it — the `CLAUDE.md` managed block written by
`packages/cli/src/installer/claude-md.ts` — carried a capability list ("here are your slash commands, here
are your subagents") and no instructions at all. With no instruction to the contrary a Claude Code session
uses its conversational default and checks in after every step, which directly contradicts the product
(README: "the design goal is full autonomy end to end. A human is required at exactly two blocking gates").
Roadmap/11 names seven stop conditions that halt a run and no phase file mapped them onto anything the
manager session can read; roadmap/10 scoped every manager hook as advisory, so no enforcement layer was
available even in principle. Two further consequences were latent rather than theoretical: the block
**collapsed to the bare line `@AGENTS.md`** whenever the target repo kept an `AGENTS.md`, deleting the
capability list too; and nothing anywhere named the tool a manager should ask questions with.

**Ruling:** Four parts.

1. **One source of truth for the protocol text.** `@crabgic/plugin`'s `src/manager-protocol.ts` owns it, and
   is the only place it is written. `buildManagerProtocolBlock()` renders the compact always-loaded form;
   `skills/protocol/SKILL.md` carries the long-form rationale; `packages/cli`'s installer renders the block
   into the managed `CLAUDE.md`. No phase restates the protocol in prose of its own. The seven stop
   conditions in it are keyed by the supervisor's own `STOP_CONDITION_KINDS` strings, and
   `packages/cli/src/installer/stop-condition-parity.test.ts` fails if the two lists ever drift.
2. **The protocol always ships.** The `@AGENTS.md` bridge (adaptation §6.2) is now **additive**: the import
   line still carries the target repo's own instructions exactly once, and Crabgic's block is emitted
   alongside it rather than replaced by it. §6.2's "one source of truth per repo" argument is about not
   duplicating *the repo's* content; Crabgic's protocol exists in no `AGENTS.md` and had no second source to
   conflict with, so collapsing the block bought no de-duplication and cost the entire protocol.
3. **`Stop` may block; `PreToolUse` still may not.** Roadmap/10's "advisory manager hooks ... non-blocking"
   scope is amended for exactly one event. `hooks/stop-autonomy-gate.mjs` is a deliberately blocking `Stop`
   hook: it refuses to end a turn while a run is in one of the six in-flight lifecycle states, and allows the
   stop at `awaiting_approval` (a human gate is legitimately open) and at the four absorbing states. The
   engine contract it rests on is `docs/engine-baseline.md` §19 — including §19.2's `stop_hook_active`
   re-entry flag, which is the loop guard. `PreToolUse` remains forbidden in the manager context: blocking a
   turn from *ending* is bounded, recoverable and loop-guarded; blocking arbitrary tool calls from a
   user-editable settings scope is none of those, and stays 03/06's worker-context privilege.
   `MANAGER_HOOK_EVENTS` in `src/hooks-manifest.ts` is the enforced allowlist (the old
   `ADVISORY_ONLY_EVENTS` name is kept as a deprecated alias).
4. **`AskUserQuestion` is how the manager asks.** Named as the tool for any decision put to the owner, with
   its structured-option shape (up to 4 questions per call, 2-4 options each, engine-supplied "Other" and
   free-text notes). Cited to `docs/engine-baseline.md` §18 — and because §18.2 records the tool's
   *interactive* presence as an in-session observation rather than a probe result, the protocol text
   **degrades gracefully**: if the tool is unavailable the instruction is one consolidated prose question,
   never a step-by-step interrogation. No shipped behavior depends on §18.2 resolving PASS.

**Rationale:** The two reported defects have one root cause — the manager was never told what it was — and
one of them needed more than prose to fix. Parts 1 and 2 make the instruction exist and make it reliably
arrive; part 3 makes the half that can be enforced deterministically actually enforced, because "be
autonomous" is precisely the instruction a model under uncertainty will violate by being polite. Part 4 is
separated from part 3 on purpose: it is a UX ruling resting on a weaker evidentiary base (§18.2), so it is
written to fail soft, whereas part 3 rests on three PASS verdicts (§19) and is allowed to fail hard.

The fail-open discipline in part 3 is not incidental. The gate runs on every session end in every project
with the plugin installed, including projects that have never started a run. Every error path — no CLI, no
supervisor, timeout, malformed JSON, unrecognized state — allows the stop. A false negative costs one
unnecessary "continue"; a false positive costs the owner a session they cannot exit.

**Phases affected:** `roadmap/10-plugin-and-installer.md` (owns the plugin, the installer, the managed block
and the hooks — carries the scope amendment), `roadmap/11-intake-contract-approval.md` (owns the seven stop
conditions and the approval flow the protocol describes).

**Implementation status (2026-07-28).** Gaps 18 and 19 are implemented on
`feat/conversation-first-orchestration`: `EnvelopePolicy` (02), `isContained` (03), the
policy-narrowed sandbox profile (03), `createRun` and the ChangeSet-keyed `run.dispatch`
(05/09), the dispatch gate and journaled digest (13), the install-time bootstrap and the
`policy.standing` doctor check (10), and the clarify/roast loops in `manager-protocol.ts`
plus the `eo-roaster` subagent (10). Verified live against the bundled binary
(`docs/evidence/gap-18/live-verification.md`) and end to end against the fake engine
(`packages/cli/src/intake/closed-loop.e2e.test.ts`). Roast rounds are recorded in
`docs/evidence/gap-18/design-roast-round-{1,2}.md`.

**Consumers in source today:** `packages/plugin/src/manager-protocol.ts`,
`packages/plugin/skills/protocol/SKILL.md`, `packages/plugin/hooks/stop-autonomy-gate.mjs`,
`packages/plugin/hooks/hooks.json`, `packages/plugin/src/hooks-manifest.ts`,
`packages/cli/src/installer/claude-md.ts`, `packages/cli/src/uds-client/passive-mode.ts`.

**Where this ruling could be got wrong later:** re-collapsing the managed block to the bare `@AGENTS.md`
bridge "per adaptation §6.2" (part 2 exists because that reading is the live defect); or generalizing part 3
into "manager hooks may block" and adding a `PreToolUse` hook to the plugin (part 3 is scoped to `Stop`
alone, and deliberately).

---

## Gap 18 — Approval is pinned per-ChangeSet to a command the user must type

**Origin:** Owner ruling 2026-07-28, from two inputs: a **live audit of the shipped `crabgic@1.3.0` binary**
(recorded below) and a product-direction decision taken in the same session. Like Gaps 16 and 17 this entry
carries its own provenance and was never seen by the four resolvers.

**Gap statement:** Three settled artifacts pin approval to a per-ChangeSet interactive terminal prompt —
adaptation §5.5 ("approval happens in the orchestrator CLI (terminal prompt) or via an explicitly-confirmed
`/eo:approve`"), roadmap/11 §In scope ("Approval: CLI terminal prompt ... mints one-time token"), and
`docs/security-posture.md` §3 (the prompt is the only mint path). The owner's product direction is that a
user **types no Crabgic command at all**: they state a request in an ordinary Claude Code session, answer
clarifying questions, and receive a finished change set. A per-ChangeSet terminal prompt is, by construction,
a command they must know and run — once per change set. The two are incompatible.

The audit added a second, independent reason the status quo is not the stronger option it appears to be.
`crabgic run --json` **prints the minted approval token to stdout**, and `contract.approve` consumes it in a
different process. In a manager session the only thing standing between those two points is the model — so
the shipped design already makes the model the courier for a human-approval token, which is precisely the
property §5.5 exists to prevent.

**Ruling:** Approval moves from *per-envelope, at dispatch time* to *per-envelope-class, ahead of time*.
Four parts.

1. **New artifact `EnvelopePolicy`**, schema owned by 02 (`@crabgic/contracts`), written by `crabgic install`
   (10) into the project's XDG **state** root, owner-only (0600), never committed to the repo. It declares
   the classes of authority a run may assume without asking: **path prefixes** (segment-aware, never globs —
   see below), allowed commands, network destinations (**default: none**), credential references (**default:
   none**), and the high-impact connector flags (02's canonical labels) it may auto-grant (**default: none**).

   **Path prefixes, not globs — corrected 2026-07-28 during implementation research, before any code was
   written.** This part first said "path globs." `validateOwnedPath` (03) already **rejects** every glob
   metacharacter in an `ownedPath`, because owned paths are literal directory names; a glob-matching policy
   would have introduced a second, richer matching language on the exact surface phase 03's CRITICAL
   owned-path confinement escape lived on. Containment is segment-aware prefix containment: `src` contains
   `src/login`, and does **not** contain `srcfoo`.
2. **The gate becomes a subset check.** At dispatch the compiled `AuthorizationEnvelope` is tested for
   containment in the `EnvelopePolicy`. Contained → the standing approval covers it; the run dispatches with
   no prompt and no token. Not contained → **dispatch is refused before a run is created**, and the
   ChangeSet stays `ready` so that fixing the policy and re-dispatching simply works. There is no third
   outcome, and no partial grant of the contained subset. 11's `expanded_authority` remains the halt for
   authority discovered to be missing **mid-run**, where the run is already `running` and `blocked` is a
   legal edge — see part 5.

   **Amended 2026-07-28 by design roast round 1** (`docs/evidence/gap-18/design-roast-round-1.md`). The
   original wording halted the run on the stop condition at dispatch. Two independent reviewers refuted it:
   `draft → blocked` is not an edge in 02's table and a run at dispatch time has no prior record, so the
   halt would have thrown `IllegalTransitionError` inside an un-awaited driver **after** `dispatch()` had
   already answered `accepted: true` — the run neither dispatched, nor blocked, nor reported. And `blocked`
   is absorbing, so even a working halt stranded the ChangeSet with no recovery path short of a hand-edited
   policy and a brand-new `requestKey`.

5. **The policy is also a compiler input, not only a gate.** This is what the roast forced, and it is the
   substantive change. `sandbox-profile.ts` deliberately leaves `filesystem.allowWrite` at the **whole
   worktree**, for a stated and correct reason: build-output directories are "project-specific and unknowable
   **here**", the compiler's only inputs being one envelope's four fields. Owned-path scoping is left to the
   permission layer — which sees *tool calls*, and by construction cannot see the syscalls of a process it
   spawned. So an allow-listed `npm run test` executing a test file the worker legitimately wrote inside its
   owned path may write anywhere in the worktree, and the containment evidence has **no child-process arm**
   to say otherwise. Under a human gate that is bounded by someone reading the diff. Under a standing
   approval nobody reads it.

   What is unknowable to the compiler is knowable to a human authoring a policy once, at install. The policy
   therefore carries `allowedWriteScratchPaths`, which narrows `allowWrite` to owned paths plus declared
   scratch, and `allowUnixSockets` (**default false**), which makes today's unconditional
   `allowAllUnixSockets: true` a declared grant rather than an ambient one. Standing approval is only sound
   once the profile's *actual* granted authority is inside what the policy can express.

6. **Unknown or absent means deny, and inert fields are never presented as controls.** A policy field the
   containment check does not recognise, or one absent from an older on-disk policy, denies — never skips.
   `remoteResourceAuthorizations` escalate by default: *any* entry is out-of-policy unless the policy names
   an allowed reference, because the high-impact flag taxonomy is assigned by static per-kind tables rather
   than by risk (a Grafana `dashboard` and a single-issue Jira update both carry **no** flag) and is in any
   case never compared against the envelope at apply time. `prohibitedActions`, `dependencies`,
   `temporaryServices` and `commands`-beyond-the-four-literals are **inert** in the compiled profile; the
   schema documents them as inert rather than letting a policy author believe they bound anything.
3. **The model can never widen the policy.** Creating or extending it is out-of-band: `crabgic install`, or a
   human editing the file. No MCP tool, no session-reachable CLI command, and no skill may write it. The
   token machinery is **not deleted** — `contract.approve`, `trust review`/`capability.approve` and
   `learn approve` keep it for the escalation paths, which are exactly the paths a policy cannot cover.
4. **Every dispatch journals the authorizing policy digest.** Evidence must be able to answer "what was the
   human standing behind when this ran," which a standing approval otherwise makes unanswerable.

**Rationale:** The property §5.5 protects is *the model cannot manufacture human consent*, and all four parts
preserve it: the policy is a human-authored artifact, the containment check is deterministic and
server-side, and anything outside it halts rather than degrading. What is **given up, knowingly**, is
per-change-set human review of in-policy work — recorded here explicitly so that nobody later "restores" the
prompt believing this ruling was an oversight.

A policy read once, carefully, at install time — declaring paths and commands with default-deny network and
credentials — is a stronger artifact than a digest rubber-stamped under time pressure once per change set.
The engine itself carries the precedent: `.claude/settings.json`'s `allowedTools` is the same shape, and is
the mechanism the owner's own standing guidance prefers over blanket permission-skipping.

**Disclosed residual risk:** the blast radius becomes whatever the policy got wrong. Four mitigations are
part of the ruling, not optional hardening: network, credential and remote-resource references default to
none; `doctor` renders the policy in full **and fails a vacuous one** (all-empty lists otherwise pass every
existence/parse/mode/untracked check while every run halts); part 4's per-dispatch digest makes every run's
authorization auditable after the fact; and part 5 brings the compiled profile's real granted authority
inside what the policy can express, without which the other three describe a boundary that is not the one
being enforced.

**Owed, and deliberately not resolved by this ruling.** Three gaps the roast surfaced sit outside it and
must not be read as covered: no dependency provisioning exists for a fresh worktree, so a first live run on
a Node repo cannot proceed at any policy setting; `RemoteMutationPlan.requiredCapabilityFlags` has no
consumer at apply time; and `envelope.commands` is inert beyond four literals. The latter two predate this
ruling — standing approval is what makes them load-bearing, not what caused them.

**Phases affected:** `roadmap/02-contracts-and-schemas.md` (owns the schema),
`roadmap/03-envelope-compiler-engine-adapter.md` (owns the containment check, as the security keystone),
`roadmap/09-cli-and-doctor.md` (the terminal prompt stops being the sole mint path; `doctor` renders the
policy), `roadmap/10-plugin-and-installer.md` (the installer writes it — carries the scope amendment),
`roadmap/11-intake-contract-approval.md` (owns the approval flow and `expanded_authority`),
`roadmap/13-scheduler-packets-context.md` (applies the check at dispatch).

**Where this ruling could be got wrong later:** reintroducing a per-ChangeSet prompt "because §5.5 says so"
(§5.5 is amended by this entry, not overridden by it); granting the contained subset of a
partially-out-of-policy envelope instead of halting (part 2 is deliberately all-or-nothing); or exposing any
policy-writing surface to a session, in any form, which collapses the whole gate (part 3).

---

## Gap 19 — Adversarial quality loops collide with `exhausted_repairs`

**Origin:** Owner ruling 2026-07-28, same session as Gap 18.

**Gap statement:** The roadmap has exactly one bounded loop for "this work is not good enough":
`exhausted_repairs`, one of 11's seven stop conditions, spent when the initial attempt plus both
evidence-driven repair attempts are used on a single WorkUnit. The owner's directive adds three
**quality-convergence** loops the roadmap never modelled — over the design, over the test suite, and over the
implementation — each running until an adversarial reviewer can no longer honestly find anything to raise.
Read together the two are contradictory: one says stop at three, the other says do not stop.

**Ruling:** They are different loops over different subjects. Both stand, unchanged in their own domain.

1. **`exhausted_repairs` is untouched.** It counts *attempts against gates* on one WorkUnit — initial plus
   two. Nothing below consumes one.
2. **A roast round is read-only.** It is an adversarial review of an artifact (design, test suite, or diff)
   that produces findings. It never re-executes work, never transitions the run, and never spends a repair
   attempt. Acting on its findings may.
3. **The loop is bounded by progress, not by rounds.** A stage keeps looping while each round closes at
   least one `blocking` finding. The first round that closes none escalates; a hard ceiling of **five**
   rounds applies regardless. `blockingClosedThisRound` is derived from finding dispositions and is never
   self-reported by the reviewer.
4. **Termination is the artifact against its written exit criteria, never reviewer exhaustion.** Each stage
   carries a checkable list of exit criteria, as stage 2's clarify loop already does with the nine
   `CONTRACT_SECTIONS`. A stage advances when every criterion is met, no open finding is classified
   `blocking`, and **every finding raised has a recorded disposition**.
   - A finding is `blocking` **only if it names the exit criterion it violates**. One that violates no
     stated criterion cannot block — and is still recorded, still verified, still answered.
   - **Novelty and falsifiability still apply**, unchanged, as admissibility tests: restatement, generality
     and taste remain inadmissible. What they no longer do is decide termination.
   - Every finding, at any severity, walks `raised → verified → classified → dispositioned → reported`.
     `verified` is by execution, not second opinion; `refuted` requires the counter-evidence. `disposition`
     is `fixed` | `refuted` | `accepted-debt` and **can never be empty**. A stage may not advance holding an
     undispositioned finding of any severity.
   - `accepted-debt` is journaled as an `EvidenceRecord`, surfaced in the change-set report, and
     **reclassified `blocking` when a later change set's `PlannedWriteSet` intersects the paths it
     concerns** — keyed with `normalizePlannedPath` from `@crabgic/git-engine`, so the debt index and the
     overlap analyzer cannot disagree about what a path names.
5. **Each round gets a fresh reviewer.** A round is only evidence of convergence if the reviewer did not
   author the artifact and did not see the previous round's verdict. Rounds differ by **lens** rather than
   repeating one hostile pass, since diversity of perspective catches failure modes repetition cannot.

**Rationale (amended 2026-07-29):** the original part 4 argued that novelty plus falsifiability are what
"honestly" denotes, and that argument stands — an adversary told to keep roasting will manufacture findings
to appear useful, and those two tests exclude exactly that. What the original got wrong is that it treated
them as a **termination** rule as well as an admissibility rule. They are not the same thing.

Rounds 21–32 are the experiment the original's own residual-risk note called for, and the result refutes the
hypothesis that note advanced. The falsifiability test was applied **strictly** — every finding across twelve
rounds carried an executed reproduction, none was manufactured, and every one was real, including two
arbitrary-file-overwrite primitives and an unkillable hang. Not one round failed to produce something novel
and falsifiable. Severity fell steadily (round 30 needed no attacker foothold; round 32 needed write access
to a 0700 directory the victim already owns) and the loop still did not converge.

The conclusion is stronger than "the test was applied loosely": **novelty and falsifiability bound
manufactured findings but not genuine ones.** A non-trivial codebase holds an effectively inexhaustible
supply of true, novel, reproducible defects of declining severity, so a criterion phrased as "until a round
finds nothing" measures reviewer exhaustion rather than artifact quality — and only one of those is finite.

**On the severity floor.** The original rejected one because "a genuine minor defect is still a defect". That
property is preserved here and is the reason the floor gates the **loop** and never the **ledger**: a minor
finding is still verified, still classified, still dispositioned, still reported, and still becomes blocking
the moment anyone touches the code it concerns. What it no longer does is hold the pipeline open forever.
This is therefore not the "severity floor as an optimization" the original warned against — it is not an
optimization, and the argument for it is measured non-termination rather than cost.

**Disclosed residual risk:** debt in code nobody ever touches again is never paid. That is accepted
deliberately — it is also debt nobody is exposed to — but it makes the journal's debt query the only place
such a finding can be seen, so the change-set report's honesty is load-bearing. Second: the `blocking` versus
`advisory` split is a judgement, and the literature is explicit that an uncalibrated judge is decorative.
There is **no calibration plan yet**; until there is, the split is asserted rather than measured, which is
exactly the posture the original's own residual-risk note refused to accept for falsifiability.

**Phases affected:** `roadmap/11-intake-contract-approval.md` (owns the seven stop conditions and thus the
boundary being drawn), `roadmap/13-scheduler-packets-context.md` (owns the repair-attempt path),
`roadmap/14-quality-security-gates.md` (owns the gate verdicts a repair attempt answers),
`roadmap/10-plugin-and-installer.md` (the manager operating protocol renders the distinction).

**Where this ruling could be got wrong later:** treating a review round as a repair attempt (or the reverse),
which either caps quality convergence or makes gate failures unbounded; letting `advisory` become a disposal
route rather than a deferral — the disposition field exists precisely so nothing is filed and forgotten, and
a stage that advances holding an undispositioned finding has broken the ruling regardless of that finding's
severity; allowing a reviewer to self-report its own progress, which turns part 3's budget into the inverted
sycophancy part 4 was written to exclude; letting a reviewer raise findings a deterministic gate already
decides, which re-litigates settled verdicts in prose; or reintroducing an unbounded round count on the
argument that quality demands it — the measured evidence is that it does not terminate, and an
unbounded loop that never closes ships nothing at all.

---

## Gap 20 — The amended review loop is stated in prose and enforced nowhere

**Origin:** Follows Gap 19's 2026-07-29 amendment. Raised while implementing it.

**Gap statement:** Gap 19 as amended says a stage closes on its written exit criteria, that a finding blocks
only by naming the criterion it violates, that every finding carries a disposition, and that debt reopens when
its code is next touched. All four are **model instructions**. The superseded loop's own defect was a model
instruction no artifact could contradict — "do not approve it" — which ran twelve rounds without converging.
Restating the fix in the same medium that failed is not a fix; it is the same bet at longer odds.

**Ruling:** the checkable half is checked, in `@crabgic/contracts`, and the rest is named as unchecked.

1. **`ReviewVerdict` / `ReviewFinding` are schemas, not conventions.** Three properties are
   **unrepresentable** rather than discouraged: a `blocking` finding with no `violates`; a finding whose
   `dispositionEvidence` is empty; and `approve` while a blocking finding is neither `fixed` nor `refuted`.
   Each maps to a way the loop failed or could fail, and each is a `superRefine` that rejects the document.
2. **`isStageClosable` is the termination rule as code.** All three conditions — every required criterion met,
   no unresolved blocking finding, no undispositioned finding at any severity. A clean review with an unmet
   criterion does not close a stage, which is the property the superseded loop lacked.
3. **`PIPELINE_STAGES` carries the criteria as data.** Ids are stable because `violates` references them; a
   name that resolves to nothing is not a constraint. `exitCriteriaFor` **throws** on an unknown stage rather
   than returning `[]`, because an empty criteria list satisfies the closure rule vacuously.
4. **The clarify stage derives its criteria from `CONTRACT_SECTIONS`, and `CONTRACT_SECTIONS` derives from
   `IntentContractSectionsSchema`'s own keys.** The plugin's hand-written copy of the nine names is deleted
   and re-exported. Rounds 4-7 are the precedent: two lists that must agree diverge, and the last attempt to
   keep them in step made mismatches six times worse.
5. **`reclassifyDebtForWriteSet` reopens debt by planned writes**, using the repository's one canonical
   `normalizePathPrefix`. Containment is checked in **both** directions — a write inside a debt's directory,
   and a write to a directory above a debt's file — because only one of those is prefix matching in the usual
   sense and checking one would silently miss half the debt. Reopening **clears** the disposition rather than
   rewriting it, so the finding is open again and its stage cannot advance.

**Rationale:** part 1 is the ruling. Everything the superseded loop got wrong was expressible in a document
that nothing rejected, so the amendment's own rules are made rejectable wherever a schema can carry them.
What a schema cannot carry — whether a reviewer classified honestly — is left to prose deliberately and named
below rather than pretended away.

**Disclosed residual risk:** the schema enforces the SHAPE of a verdict and not its HONESTY. A reviewer can
still classify a real blocker as `advisory`, or attach a plausible `violates` to a taste preference, and every
document it produces will validate. The `blocking`/`advisory` split has **no calibration** — no sample where
it has been checked against the owner's own judgement — so it is asserted, not measured. This is the same
posture Gap 19's original entry refused to accept for falsifiability, and it is recorded in those terms rather
than as a footnote.

Second, and **partly closed 2026-07-29**: `review.submit` now calls `isStageClosable` and
`reclassifyDebtForWriteSet` server-side and returns the closure decision, so a reviewer supplies findings and
does not supply the verdict on itself — the same shape as `contract.approve`, for the same reason. Three
inputs are deliberately not taken from the caller: which criteria the stage requires, which are met, and
whether the stage may close.

The durable store landed too, in XDG state rather than the journal. `JournalEntryType`'s closure at thirteen
is respected — no fourteenth member was added — and `EvidenceRecord` was rejected on its merits rather than
bent to fit: its `objectId` is a Git object id, not a payload pointer, and `command`/`toolchainFingerprint`
are required fields a review has no honest value for. The precedent for XDG state is the `EnvelopePolicy`
itself, which decides what runs without review and does not live in the journal either; findings are strictly
less privileged. It sits behind `loadFindings`/`saveFindings`, so a coordinated round adding a `review_verdict`
kind later is a migration and not a redesign.

Registration landed too. `review.submit` is in the shipped binary's tool surface, verified by driving the real
MCP server over stdio rather than by reading the registry, and the assertion that pins what the binary exposes
lists it — a tool reaching production without appearing there is a surface nobody decided to ship. Two of its
inputs come from the SERVER and never the caller: planned writes from the ChangeSet's own envelope
`ownedPaths`, so a reviewer cannot understate what it intends to touch and thereby choose which debt it
faces; and prior findings from the durable store, so a clean round cannot erase somebody else's open blocker.

**The gate-decidable criterion is derived, not believed.** `implement-gates-pass` is computed from the
`EvidenceRecord`s journaled against the ChangeSet — the same signal the release gate scores on, where a linked
record with a nonzero `exitStatus` is a genuine negative run — and then SUBTRACTED from whatever the caller
claimed, so asserting it without gate evidence to back it does not work. Records carrying no `gateTag` are
skipped rather than counted, since Gap 6's rendered-artifact evidence is not a gate firing. An empty evidence
set yields nothing: gates that never ran are not gates that passed, and treating absence of proof as proof is
how a stage closes on work nobody verified.

**The limit that remains.** The other criteria are judgements — "every risk carries a mitigation", "every task
states how it will be known done" — and those still arrive as caller-supplied `metCriteria`. No tool can
decide them, which is why they are stated as criteria a reviewer checks rather than as gates. What holds is
that the reviewer cannot satisfy its own gate and that nothing gate-decidable is taken on trust; what does not
is that a caller misreporting a judged criterion is caught.

**Phases affected:** `roadmap/02-contracts-and-schemas.md` (owns the contracts these join),
`roadmap/11-intake-contract-approval.md` (owns the stop condition a spent budget escalates through),
`roadmap/13-scheduler-packets-context.md` (owns the repair-attempt boundary a review round sits beside),
`roadmap/10-plugin-and-installer.md` (renders the protocol these enforce).

**Where this ruling could be got wrong later:** adding a disposition that means "ignored", which reintroduces
the disposal route the whole design exists to prevent; relaxing `approve` so it tolerates an open blocker,
which makes the verdict advisory; giving `exitCriteriaFor` an empty-list fallback, which closes stages
vacuously; or writing a second path matcher for the debt index instead of importing the canonical one.

---

## Provenance

The 15 gaps and the four independent resolution passes originate from a prior workflow run whose raw output
(4 agents × 15 resolutions each) survived only in a transient journal. This ledger consolidates that
four-way record into one binding ruling per gap and replaces it as the durable reference — every ruling above
was cross-checked against the current text of all 24 rewritten phase files, not taken on the raw record's
word.

**Gap 16 is outside that provenance** and says so in its own "Origin" line: it was identified during
phase-23 release-gate remediation on 2026-07-25, was never seen by the four resolvers, and is **awaiting
owner ratification**. Its "Verified in" anchors therefore cite the implementing source files rather than
roadmap phase text; the coordinated one-line additions to 01, 15 and 23 that the ruling required have since
been landed and are recorded in the entry's own "Coordinated phase-file edit" line. Later gaps found during
implementation should follow the same shape rather than being retrofitted into the four-resolver narrative.
