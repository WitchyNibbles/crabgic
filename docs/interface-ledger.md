# Interface Ledger — Engineering Orchestrator Roadmap

This file is the **binding cross-phase interface contract** for the crabgic / Engineering Orchestrator
roadmap (`roadmap/00-*.md` through `roadmap/23-*.md`, indexed by `roadmap/README.md`). It records the single
ruling decision for each of 15 cross-phase interface gaps that were identified against the roadmap and
independently adjudicated by four parallel resolver passes.

**The four resolver passes did not agree with each other** — on several gaps (notably Gap 1, Gap 2, Gap 11,
and the path-order half of Gap 14) their decisions materially conflict, even though all 15 gaps were stamped
`RESOLVED` by all four. **This ledger is not a vote count.** For every gap below, the "Ruling" is the decision
the 22 already-rewritten phase files actually implement today, verified by reading those files directly — not
the majority position among the four resolvers, and not editorial preference. Each gap's "Where the 4
resolvers disagreed" line names the rejected alternative(s) on the record, so nobody reintroduces a
rejected branch later believing it was never considered.

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
| [1](#gap-1--gateway-mcp-tool-surface-is-fragmented) | Gateway MCP tool surface fragmented | One `eo_gateway` registry hosted by Phase 16; `change_set.*`/`learning.*` deleted; `run.status`/`run.cancel` forwarded over UDS |
| [2](#gap-2--cli-gateway-mcp-subcommand-never-declared) | CLI `gateway mcp` never declared | Declared in Phase 09, backend Phase 16's registry, no user-facing flags |
| [3](#gap-3--packagesengine-core-and-renderer-core-are-unscaffolded) | `engine-core`/`renderer-core` unscaffolded | `engine-core` = 18th package (Phase 01); `renderer-core` = module inside `packages/contracts` (Phase 02), not a package |
| [4](#gap-4--parkedrate_limit-is-missing-from-the-phase-02-run-lifecycle-state-machine) | `parked:rate_limit` missing from run lifecycle | New orthogonal `WorkUnitAttemptStatus` union (6 members); Run lifecycle untouched |
| [5](#gap-5--no-journal-entry-type-enum-is-ever-named) | No journal entry-type enum named | `JournalEntryType`, 13 members, owned by Phase 02 |
| [6](#gap-6--prreview-comment-artifacts-are-rendered-with-no-delivery-mechanism) | PR/review-comment artifacts have no delivery mechanism | Terminal handoff copy only, attached as evidence, retrieved via `evidence <change-set-id>`; no VCS connector, ever |
| [7](#gap-7--engineadaptercapabilities-field-name-mismatch) | `capabilities()` field-name mismatch | `supportsJsonSchema`/`supportsSessionResume` win (adaptation doc's names) |
| [8](#gap-8--resultsubmit-vs-result_submit) | `result.submit` vs `result_submit` | `result.submit` (dot form) wins |
| [9](#gap-9--phase-12--phase-13-consumption-claim-contradicts-the-dependency-graph) | Phase 12→13 consumption claim contradicts the graph | Fixed: consumed by Phase 11, not 13 |
| [10](#gap-10--capability-flag-label-drift) | Capability-flag label drift | Phase 02's labels win verbatim: `closing transitions`, `bulk mutations` |
| [11](#gap-11--eo_gateway--mcpeo_gateway-literal-names-never-echoed-in-the-roadmap) | `eo_gateway` literal never pinned | Named constant `GATEWAY_MCP_SERVER_NAME` owned by Phase 02, imported everywhere |
| [12](#gap-12--permission-rule-syntax-drift-from-the-cited-baseline) | Permission-rule syntax drift | No space before colon; only the 4 doc-confirmed literals; wider cases routed to a Phase 00 probe |
| [13](#gap-13--minor-phase-03s-sources-field-never-cites-docsengine-baselinemd) | Phase 03 doesn't cite `docs/engine-baseline.md` | Citation added |
| [14](#gap-14--minor-two-independent-xdg-cache-usages-with-no-shared-pinned-path-constant) | Two unpinned "XDG cache" usages | Pinned once in Phase 04, sibling to `$XDG_STATE_HOME` |
| [15](#gap-15--minor-engine-live-ci-job-name-and-live-test-tag-never-explicitly-linked) | `engine-live`/`@live` link never stated | Phase 01 states Phase 06 wires it; Phase 06 does |

---

## Gap 1 — Gateway MCP tool surface is fragmented

**Gap statement:** The adaptation doc treats the gateway MCP tool surface as one settled, ~9-family list on a
single server. In the roadmap as originally drafted, only `tracker.*`/`observability.*` were fully specified
(in Phase 16); `project.inspect`/`contract.approve` (Phase 11), `capability.audit`/`capability.approve`
(Phase 12), `evidence.*`, `result.submit`, and forwarded `run.status`/`run.cancel` were scattered or
contradictory, and a `change_set.*` and a `learning.*` family were asserted by some readings with zero
roadmap presence.

**Ruling:** There is exactly **one** MCP server, `eo_gateway` (`GATEWAY_MCP_SERVER_NAME`, Gap 11), exposing a
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

**Gap statement:** Adaptation §6.1 names the literal invocation `engineering-orchestrator gateway mcp` as the
exact `.mcp.json` stdio command Phase 10 writes, but no earlier draft of Phase 09 (owner of the CLI surface)
declared any such subcommand.

**Ruling:** `gateway mcp` is a command owned and declared by Phase 09 (`packages/cli`), taking **no
user-facing flags**, running as a **long-running stdio process**. It boots the `eo_gateway` MCP server over
Phase 16's extensible tool registry (Gap 1), addressed by the `GATEWAY_MCP_SERVER_NAME` constant (Gap 11).
Phase 09 supplies only the argv shim, help text, and stdio boot — it implements none of the registered
tools' logic. This is the exact string Phase 10 writes as the `command`/`args` of the `.mcp.json` entry keyed
`GATEWAY_MCP_SERVER_NAME`: `{"eo_gateway": {"command": "engineering-orchestrator", "args": ["gateway",
"mcp"]}}` (byte-golden-tested in Phase 10). Full 8-family tool-surface completeness (zero `NOT_IMPLEMENTED`)
is explicitly deferred to Phase 23's release gate, not required at Phase 09/16's own build time.

**Phases affected:** 09, 16

**Verified in:**
- `09-cli-and-doctor.md` §In scope — *"gateway mcp: boots the `eo_gateway` MCP server (stdio) over
  `packages/gateway`'s (16) extensible tool registry…"*; §Work items 1–2; §Exit criteria, line 203 —
  *"`gateway mcp` starts and lists exactly the resolved tool set over stdio to a stub MCP client… full
  8-family completeness remains a phase-23 release gate."*
- `10-plugin-and-installer.md` §Work items 2 — golden-file test of the `{"eo_gateway": {"command":
  "engineering-orchestrator", "args": ["gateway", "mcp"]}}` shape; §Exit criteria — byte-for-byte assertion
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

## Gap 11 — `eo_gateway` / `mcp__eo_gateway__*` literal names never echoed in the roadmap

**Gap statement:** The adaptation doc asserts these as settled, verified identifiers (§2 row 11, Appendix B),
but no roadmap phase's own text ever wrote the literal string — three different phases (06, 10, 16) need to
agree on it byte-for-byte for `--strict-mcp-config` to resolve correctly.

**Ruling:** The server name is pinned as a single named constant, `GATEWAY_MCP_SERVER_NAME = "eo_gateway"`,
exported from `packages/contracts` (Phase 02) — **not** independently hand-typed as a literal string in each
consuming phase. Every consumer imports the constant: Phase 03's compiler derives the mandatory
`mcp__${GATEWAY_MCP_SERVER_NAME}__*` permission-allow entry from it; Phase 06's `mcpServers` key and
`strictMcpConfig` allowlist reference it (with a dedicated test asserting zero hand-typed `"eo_gateway"`
literals anywhere in `packages/engine-claude`); Phase 10's `.mcp.json` entry key is golden-tested against it;
Phase 16 registers its SDK MCP server under it and derives the `mcp__${GATEWAY_MCP_SERVER_NAME}__<tool>`
wire-prefix from it (pending — see below). Phase 02 enforces itself as the sole definition site with a
repo-wide grep/golden-value CI check.

**Phases affected:** 02, 03, 06, 09, 10, 11, 12, 16, 23 — 11/12 import the constant for tool-registry
registration (11:68, 12:43) and 23 release-gates it; 11/12/23 added 2026-07-15

**Verified in:**
- `02-contracts-and-schemas.md` §In scope — *"`GATEWAY_MCP_SERVER_NAME` constant: `"eo_gateway"` — the single
  literal every engine-side MCP registration derives from… no phase hand-types the literal a second time"*;
  §Exit criteria — "a repo-wide grep/golden-value CI check fails if the literal appears a second time under
  `packages/*`."
- `03-envelope-compiler-engine-adapter.md` §In scope, line 18 — *"the mandatory
  `mcp__${GATEWAY_MCP_SERVER_NAME}__*` allow entry is derived programmatically from `GATEWAY_MCP_SERVER_NAME`
  (constant, 02…), never hand-typed a fourth literal (Gap 11)."*
- `06-claude-engine-adapter.md` §In scope "Gateway wiring (Gap 11, Gap 2)," line 17; §Exit criteria, line
  101 — "zero hand-typed `"eo_gateway"` literals anywhere in `packages/engine-claude` — `gateway-name-
  reference.test`."
- `09-cli-and-doctor.md` §Interfaces consumed, line 129 — *"`GATEWAY_MCP_SERVER_NAME = "eo_gateway"` —
  `gateway mcp`'s server identity."*
- `10-plugin-and-installer.md` §In scope — ".mcp.json entry keyed `GATEWAY_MCP_SERVER_NAME`"; §Work items 2 —
  golden-file test against the constant.
- `11-intake-contract-approval.md` §Interfaces consumed, line 68 — *"`GATEWAY_MCP_SERVER_NAME = "eo_gateway"`,
  constant owned by 02 — Gap 11"*; imports the constant to register `project.inspect`/`contract.approve` into
  the shared tool registry (Gap 1).
- `12-stack-detection-quarantine.md` §Interfaces consumed, line 43 — *"`GATEWAY_MCP_SERVER_NAME` constant
  (`"eo_gateway"`)"* used for its `capability.audit`/`capability.approve` tool-registry registration.
- `23-release-hardening.md` §Interfaces consumed, row "02," line 62 — lists `GATEWAY_MCP_SERVER_NAME` among
  the release-gated contracts.
- `16-gateway-core.md` now references the constant explicitly — §In scope names `GATEWAY_MCP_SERVER_NAME`
  directly ("this phase hosts the one `eo_gateway` MCP server (`GATEWAY_MCP_SERVER_NAME`, constant owned by
  02)"); §Interfaces consumed states *"this phase's SDK server registration and every wire-level
  `mcp__${GATEWAY_MCP_SERVER_NAME}__<tool>` name derive from this; never a second hand-typed literal"* —
  matching every *other* phase's description of what Phase 16 does with it.

**Where the 4 resolvers disagreed:** A real conflict. Two resolvers proposed hand-typing the literal
`"eo_gateway"` independently into Phase 16/10/03's own prose (no shared constant, just matching strings by
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
`$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/`. Phase 07's control clone nests at
`.../git-control/`; Phase 12's capability store nests at `.../capability-store/`. Phase 07 and Phase 12 cite
Phase 04's constant rather than independently inventing "XDG cache" phrasing or a differing path-segment
order.

**Phases affected:** 04, 05, 07, 08, 12, 14, 23 — 04 pins the cache-root constant, 07/12 nest under it,
08/14/23 embed the `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/…` subpath convention
(08:21/59, 14:48, 23:67), and 05 embeds the same pinned convention via its `$XDG_STATE_HOME/…` state-root
sibling (05:24) — expanded 2026-07-15 (same under-coverage class as Gaps 4/5/10/11)

**Verified in:**
- `04-journal-idempotency-leases.md` §In scope, "Layout" bullet, line 22 — *"`$XDG_CACHE_HOME/engineering-
  orchestrator/<project-hash>/` — cache root, pinned here as a sibling constant (Gap 14): 07's control clone
  nests at `.../git-control/`, 12's capability store nests at `.../capability-store/`. 04 pins the shared
  root; 07/12 own writing under it"*; §Interfaces produced, line 47 — same constant as an exported layout
  constant; §Exit criteria — "`$XDG_STATE_HOME`/`$XDG_CACHE_HOME` engineering-orchestrator roots are defined
  exactly once in this package."
- `07-git-control-repo-worktrees.md` §In scope, "Control clone," line 17 — "into
  `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/git-control/` (cache-root convention pinned in
  04)"; §Interfaces produced, line 39, and §Exit criteria, line 80 — the same path repeated as a
  path-convention test.
- `12-stack-detection-quarantine.md` §In scope, line 21 — "Content-addressed capability store under
  `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/capability-store/` (same convention, pinned in
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

## Provenance

The 15 gaps and the four independent resolution passes originate from a prior workflow run whose raw output
(4 agents × 15 resolutions each) survived only in a transient journal. This ledger consolidates that
four-way record into one binding ruling per gap and replaces it as the durable reference — every ruling above
was cross-checked against the current text of all 24 rewritten phase files, not taken on the raw record's
word.
