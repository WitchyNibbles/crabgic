# Design — Collapse the duplicated `CPU_BUDGET_FRACTION` into one exported constant

**Change set:** 7d3f8a21-6c94-4e5b-a83f-2b410d97e6c5
**Stage:** design (stage 3 of 9) · **Design revision:** r1
**Produced:** 2026-08-18, owner ruling R7's staged run

## Decision

Declare `CPU_BUDGET_FRACTION` **once, as `export const`, appended to
`packages/supervisor/src/idle-budget/resource-probe.ts` after `cpuFractionBetween`**
(currently the file's last declaration, `:37-45`), and import it at both assertion sites.
Same name, same value, no new module, no barrel edit, no production consumer invented.

Three consequences are decided here rather than discovered later: the two test files' line
numbers **will** move and the change set repairs the citations that pin them;
`RSS_BUDGET_BYTES` does **not** move; `e2e/attestation` is not touched (owner ruling at
clarify).

### Why `resource-probe.ts`, and how it stands against the prior art

The prior art is real and is in this directory: `heartbeat-scheduler.ts:14` is
`export const HEARTBEAT_INTERVAL_MS = 5_000;`, read by its own production function at `:31`
(`const intervalMs = options.intervalMs ?? HEARTBEAT_INTERVAL_MS;`) and imported by the
sibling test at `idle-budget.integration.test.ts:11`, asserted at `:20`.

**This design follows that pattern in the half that transfers and refuses to fake the half
that does not.**

| half of the pattern                                         | followed? | why                                                                                                                                                                              |
| ----------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| declared once in a **production** module, imported by tests | **yes**   | identical shape; `resource-probe.ts` is one of the directory's two non-test modules                                                                                              |
| already re-exported from the package barrel                 | **yes**   | `packages/supervisor/src/index.ts:80` is `export * from "./idle-budget/resource-probe.js";` — no barrel edit needed                                                              |
| consumed by a **production** function                       | **no**    | `HEARTBEAT_INTERVAL_MS` has a real reader at `heartbeat-scheduler.ts:31`; a CPU _budget_ has none, and inventing one to imitate the pattern would be designing past the contract |

`resource-probe.ts` over `heartbeat-scheduler.ts`: the module that defines the quantity
should carry its bound. `cpuFractionBetween` (`resource-probe.ts:36-45`) computes the exact
number the budget bounds, so unit and bound sit together and cannot drift apart. The
scheduler module owns cadence, not thresholds.

It is also the smallest diff available: **both** tests already import from
`./resource-probe.js` (`idle-budget.integration.test.ts:12`,
`heartbeat-scheduler.test.ts:9`), so each call site adds one token to an existing import
line and deletes one line. No file gains an import line.

**Placement inside the file is load-bearing:** appended _after_ `cpuFractionBetween`, so no
existing line in `resource-probe.ts` moves.
`docs/evidence/criteria-closeout/defects/05-idle-budget-arm-not-calibrated-for-its-channel.md:38`
cites `resource-probe.ts:37-45` for that computation; a constant inserted at the top would
silently invalidate it for nothing.

### Why the name does not change

`CPU_BUDGET_FRACTION` is quoted verbatim inside merged, content-checked evidence:
`docs/evidence/criteria-closeout/phase-05.json:303` and `:313`, and the frozen transcript
`docs/evidence/phase-05/wi6-heartbeat-scheduler-failing.txt:14`. A moved line is a
repairable pin (`MOVED`); a renamed identifier makes the quoted text **absent** from the
file, which no baseline regeneration repairs into a true statement. Renaming is therefore a
strictly worse outcome than moving, and is rejected.

### Why `RSS_BUDGET_BYTES` stays

`idle-budget.integration.test.ts:14` declares it once, repo-wide. There is no duplication to
collapse, so moving it fixes no failure class and only widens the diff into a ticked
criterion's other cited constant. It also sits _above_ the deleted line, so it does not move
at all — `roadmap/05-supervisor-daemon.md:122`'s `:14-15` pointer stays exact for its
`100 MiB` half. The asymmetry it leaves is answered by element **E3**, not by scope creep.

## Elements and interfaces

### Elements

| id     | element                                                                                                                                                                                                                                                                                                                                                                            | what it is                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **E1** | **The single declaration.** `export const CPU_BUDGET_FRACTION = 0.01;` appended to `resource-probe.ts` after `:45`, with a doc comment naming `<1% of one core` (`roadmap/05-supervisor-daemon.md:25`) and the two-sites ruling                                                                                                                                                    | the collapse itself                                                            |
| **E2** | **The two call sites.** `idle-budget.integration.test.ts:12` and `heartbeat-scheduler.test.ts:9` each gain `CPU_BUDGET_FRACTION` in their existing `./resource-probe.js` import; `:15` and `:11` are deleted. Assertions at `:46` and `:39` and the log line at `:42` are untouched in text                                                                                        | removes both private copies                                                    |
| **E3** | **The re-duplication guard.** A new `one-cpu-budget-declaration.test.ts`: raw-text scan of every `.ts` under `src/idle-budget/`, asserting no file other than `resource-probe.ts` declares `CPU_BUDGET_FRACTION =`, with `expect(files.length).toBeGreaterThan(0)` as the anti-vacuity control. Modelled on `packages/supervisor/src/router/no-change-set-operation.test.ts:51-53` | makes the _reappearance_ of a private copy fail a test rather than pass review |
| **E4** | **The citation repair.** Re-pin the baseline and write dated corrections beside — never over — the merged records pinning the two edited files                                                                                                                                                                                                                                     | keeps `check:citation-content` green and the evidence corpus honest            |
| **E5** | **The scope fence.** Nothing under `e2e/`; E3's scan is confined to `packages/supervisor/src/idle-budget/` so the guard can never grow into a demand to merge the third copy                                                                                                                                                                                                       | carries the owner ruling into an executable form                               |
| **E6** | **Value non-goal.** `0.01` unchanged, both windows unchanged                                                                                                                                                                                                                                                                                                                       | the contract's stated non-goal                                                 |

### Interfaces

| interface                                                                | owning package               | change                                                      |
| ------------------------------------------------------------------------ | ---------------------------- | ----------------------------------------------------------- |
| `CPU_BUDGET_FRACTION` (module `src/idle-budget/resource-probe.ts`)       | **`@crabgic/supervisor`**    | **new export**                                              |
| public barrel (`src/index.ts:80`, `export *`)                            | **`@crabgic/supervisor`**    | gains one name transitively; **no edit to the barrel file** |
| `sampleResourceUsage` / `cpuFractionBetween` (`resource-probe.ts:13-45`) | **`@crabgic/supervisor`**    | unchanged                                                   |
| `HEARTBEAT_INTERVAL_MS` (`heartbeat-scheduler.ts:14`)                    | **`@crabgic/supervisor`**    | unchanged — the pattern source, not a participant           |
| `SUPERVISOR_IDLE_CPU_FRACTION_BUDGET` (`performanceContracts.ts:91`)     | **`e2e/attestation`**        | **deliberately unchanged** (owner ruling)                   |
| `citation-content-baseline.json` pin set                                 | repo root `crabgic-monorepo` | re-pinned by `--update-baseline`                            |

### ⚠️ What moves, stated before it is discovered

`check:citation-content` pins **exact line positions repo-wide** and is blocking
(`package.json:43` chains it into `check:all`). Three baseline entries pin lines inside the
two edited files.

**And the trap this design exists to name.** Those pins carry `!span`. Editing a citation's
`quotedAssertion` re-classes the entry as `unanchored`, and `--update-baseline` then
**refuses** (`scripts/check-citation-content.mjs:510-528`). So a well-meant "just fix the
line numbers in the record" hard-blocks the change set. The permitted form is the owner-ruled
correction recipe (`docs/evidence/citation-resolver/README.md:53-79`): **widen the `ref` to
cover the fragments the assertion walks, and write stale line numbers in backticks, never in
the file-quote notation.**

`roadmap/05-supervisor-daemon.md:122` is a **ticked** criterion citing
`idle-budget.integration.test.ts:45-46` and `:14-15`. Its wording before the first `— **` is
hash-frozen (`scripts/check-criteria-closeout.mjs:480-483`), so the correction goes **inside
the existing `— **Evidence …**` annotation** and nowhere else. No exit criterion is added,
removed or reworded.

Two further documents assert "each file carries its own private `CPU_BUDGET_FRACTION = 0.01`"
and are checked by **nothing** — `docs/evidence/gap-18/known-gate-flakes.md:119-124` and
`docs/verification-playbook.md:989-991`. E4 appends a dated line to each rather than editing
the sentence.

## How each acceptance criterion is met

| #        | acceptance criterion                                                   | element | mechanism                                                                                                  |
| -------- | ---------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| **R1#1** | exactly one declaration under the directory, and it is exported        | **E1**  | `export const` appended to `resource-probe.ts`; already public via `index.ts:80`                           |
| **R1#2** | both assertion sites import it; neither declares a private copy        | **E2**  | `:15` and `:11` deleted; the name added to each existing `./resource-probe.js` import                      |
| **R1#3** | the value is `0.01`, unchanged from both prior copies                  | **E6**  | the literal moves file, not value                                                                          |
| **R2#1** | `heartbeat-scheduler.test.ts` imports and asserts against the constant | **E2**  | assertion text at `:39` is identical after the edit, which is also what keeps the merged quotes anchorable |
| **R2#2** | `idle-budget.integration.test.ts` imports it, including in its message | **E2**  | the log line at `:42` is untouched in text                                                                 |
| **R2#3** | the full suite passes with no new failures                             | **E4**  | baseline regenerated, merged records corrected by the recipe; `npm run check:all` is the pass condition    |

## Risks

| id        | risk                                                                                                                                           | mitigation / acceptance                                                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RK-1**  | the citation repair is attempted by editing `quotedAssertion` → entry flips `unanchored` → `--update-baseline` refuses → the change set stalls | **Mitigated:** the trap and the only permitted form are named above. `--allow-unanchored` is forbidden here — it writes a confession into the baseline           |
| **RK-2**  | post-edit line numbers are mispredicted, so the pasted corrections are themselves wrong                                                        | **Mitigated:** corrections come from `check:citation-content --report`'s generated dated lines, never hand-counted; this design predicts a _class_, not a number |
| **RK-3**  | editing `roadmap/05:122` disturbs the frozen criterion wording or the ticked count                                                             | **Mitigated:** text appended strictly inside the existing evidence annotation; `check:criteria-closeout` is the pass condition                                   |
| **RK-4**  | the constant becomes a public export with no production consumer                                                                               | **Accepted:** the alternative costs a new file, a barrel decision and two extra import lines for no defect closed. The barrel's collision check is satisfied     |
| **RK-5**  | a future reader imports it into `e2e/attestation`, creating the coupling the owner ruled out                                                   | **Mitigated:** E1's doc comment states the ruling and cites `roadmap/15:39` and `roadmap/05:38` at the declaration, where an importer will read it               |
| **RK-6**  | one shared bound now spans two arms with different windows and flake profiles                                                                  | **Accepted, and it is the intent:** precondition 0 asks for exactly this. Remedies 1 and 2 remain open and unblocked                                             |
| **RK-7**  | `RSS_BUDGET_BYTES` stays local beside an imported CPU budget; the asymmetry invites re-declaring CPU locally                                   | **Mitigated by E3** — a re-declaration fails a test                                                                                                              |
| **RK-8**  | two evidence documents assert the old duplication and are checked by nothing                                                                   | **Mitigated:** E4 appends a dated annotation to both, never rewriting                                                                                            |
| **RK-9**  | R6's changed-line coverage scores the new production line                                                                                      | **Mitigated:** the added line is a module-level `export const`, executed on import by both suites plus E3; no new branch                                         |
| **RK-10** | the idle-CPU arm breaches during this change set's own CI run                                                                                  | **Accepted:** out of contract scope (the value is a stated non-goal). A breach is the pre-existing defect, disposed against that record                          |

## Ledger reconciliation

**Nothing in `docs/interface-ledger.md` is contradicted, and one ruling is deliberately
stayed clear of.** The ledger's binding rule covers "a tool name, a schema member, a **shared
constant**, a path convention, an enum label, a delivery boundary" (`:32-36`), so this check
is real rather than pro forma.

- **Gap 21 — budget provenance.** Does not reach this constant. It governs
  `PerformanceContract` budgets derived at intake; the supervisor idle budget is excluded by
  name (`roadmap/15:39`, `roadmap/05:38`).
- **⚠️ Gap 16 — phase-23 CI evidence records** pins constants **in the very file the third
  copy lives in** (`interface-ledger.md:893-895`). This is why the owner's two-sites ruling
  matters structurally and not merely in effort: reaching into that module would require the
  coordinated multi-phase edit `:32-36` demands. **E5 keeps the change set out of it.**
- **Gap 20 — the design record's own shape.** Followed: every interface names an owning
  package, every risk carries a mitigation or a stated acceptance.
- **Gaps 1-15, 17-19, 22, 23** name no supervisor idle-budget constant, no path this change
  touches, and no identifier it adds, renames or deletes.

**No ledger edit is proposed, and none is required.** The constant becomes a cross-phase
interface only if someone outside `@crabgic/supervisor` imports it, which RK-5 mitigates and
E5 forbids for the one candidate.

## Alternatives considered and rejected

| alternative                                                           | rejected because                                                                                                                                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| declare it in `heartbeat-scheduler.ts` beside `HEARTBEAT_INTERVAL_MS` | the bound belongs with the quantity; it would also make `heartbeat-scheduler.test.ts` import a threshold from its own subject-under-test's module                                                           |
| a new `idle-budget/budgets.ts`                                        | its only consumers would be tests, which the barrel convention answers "exclude" — leaving a production module deliberately outside the public surface, a decision this contract did not ask anyone to take |
| export from one test file and import into the other                   | no `*.test.ts` in this repository exports a constant (research q4's measured search), and it puts a shared threshold where no production module can read it                                                 |
| rename to `SUPERVISOR_IDLE_CPU_FRACTION_BUDGET`                       | turns repairable **moved** pins into **absent** quoted text in three merged records. Strictly worse evidence outcome for cosmetics the contract did not ask for                                             |
| preserve line numbers with a filler comment                           | freezes two files' layout to a merged citation forever and side-steps an apparatus this repository designed and blocked CI on precisely for this case                                                       |
| also collapse `e2e/attestation`'s third copy                          | ruled out by the owner at clarify; recorded so it is not re-proposed                                                                                                                                        |
| also move `RSS_BUDGET_BYTES`                                          | one declaration repo-wide — no duplication, so no failure class to eliminate                                                                                                                                |
| skip E3 and rely on review                                            | the failure this closes is a _silently re-introducible_ one. A structural check outlives the reviewer who would have to remember                                                                            |

## What this design does NOT do

- **Does not change `0.01`, either window, or any assertion's semantics.**
- **Does not touch `e2e/attestation`**, `packages/perf`, or any `PerformanceContract` surface.
- **Does not add, remove or reword a roadmap exit criterion**, and does not re-tick `roadmap/05:122`.
- **Does not rewrite any merged record or committed transcript.** Every correction is appended and dated.
- **Does not edit the package barrel** or any downstream consumer.
- **Does not invent a production consumer** to make the constant resemble `HEARTBEAT_INTERVAL_MS`.
- **Does not resolve the flake**, and does not claim the collapse makes the arm more reliable — only that a future remedy can now land in one place.
