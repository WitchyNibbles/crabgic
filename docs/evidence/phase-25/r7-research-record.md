# Research record — collapse the duplicated `CPU_BUDGET_FRACTION` constant in `packages/supervisor/src/idle-budget/`

**Change set:** 7d3f8a21-6c94-4e5b-a83f-2b410d97e6c5
**Produced:** 2026-08-17 — owner ruling R7's staged run, stage 1 of 9 (`research`)

## Questions and answers

### q1 — Where exactly are the two duplicate declarations?

**Answer:** One private `const` declaration per test file, same name, same value.

**Citations:**

- `packages/supervisor/src/idle-budget/idle-budget.integration.test.ts:15` — "`const CPU_BUDGET_FRACTION = 0.01; // <1% of one core`"
- `packages/supervisor/src/idle-budget/heartbeat-scheduler.test.ts:11` — "`const CPU_BUDGET_FRACTION = 0.01; // <1% of one core`"

### q2 — Is the value identical in both?

**Answer:** Yes — both declarations assign `0.01`.

**Citations:**

- `packages/supervisor/src/idle-budget/idle-budget.integration.test.ts:15` — "`const CPU_BUDGET_FRACTION = 0.01; // <1% of one core`"
- `packages/supervisor/src/idle-budget/heartbeat-scheduler.test.ts:11` — "`const CPU_BUDGET_FRACTION = 0.01; // <1% of one core`"

_Round 2 (`completeness`, blocking, fixed): this answer originally carried no
`Citations:` block, on the ground that q1's quotes were the proof. The obligation
`research-questions-answered` requires every answer to carry a citation of its own, and
`research-record.ts:130`'s `isSilentlyAssumed` treats an answered, uncited question with
no covering assumption entry as CONTRADICTING `research-no-silent-assumptions` — so the
Assumptions section's "None" claim could not stand beside it. The citations are repeated
here rather than cross-referenced._

### q3 — Does anything else reference either constant, or a third copy of the same threshold?

**Answer:** No other reference to the two test-local `CPU_BUDGET_FRACTION` identifiers exists, but a
**third, independent declaration of the same 0.01 threshold** exists under a different name, in a
different package, for a different measurement path. Wording correction (round 5, `d57c7c9e`,
advisory, fixed): this answer previously called that third declaration a "private copy", which its
own quoted citation contradicts — it is `export const`. It is private only in the weaker sense that
its consumers are confined to its own package: `grep -rn "SUPERVISOR_IDLE_CPU_FRACTION_BUDGET"
--include=*.ts .` (excluding `node_modules/`, `dist/`) returns **7 hits in 2 files**, both under
`e2e/attestation/src/`, and nothing in `packages/supervisor` imports it. That is not the q1 sense of
"private" (an unexported test-local `const`), and the two are no longer described with one word.

**Citations:**

- `e2e/attestation/src/performanceContracts.ts:90-91` — "`/** 05 §Idle resource budget: "<1% core". */`" / "`export const SUPERVISOR_IDLE_CPU_FRACTION_BUDGET = 0.01;`"
- `e2e/attestation/src/performanceContracts.test.ts:118` — "`expect(SUPERVISOR_IDLE_CPU_FRACTION_BUDGET).toBe(0.01);`" — confirms the third constant is live and asserted against, not dead code.

**Search scope, stated so the completeness claim below is checkable rather than implied:**
`grep -rn "0\.01" --include=*.ts .`, excluding `node_modules/` and `dist/`. That returns
**8 tracked files**, and all 8 are accounted for here: 2 are the duplicates in q1, 2 carry the
third copy above, and the remaining 4 are ruled out immediately below.

**Other `0.01` hits ruled out as unrelated** (each opened, none the same threshold):

- `packages/perf/src/contract/acceptance-criteria-parser.test.ts:75` — `error_rate >= 0.01`, a parser fixture.
- `packages/cli/src/review/binomial-bounds.test.ts:87` — a statistical `alpha`.
- `packages/testkit/src/fake-engine/engine-result-to-worker-result.test.ts:18` — a fake `totalCostUsd`.
- `e2e/attestation/src/perfContractRerun.test.ts:27` — "`loadPerCore: 0.01,`", a `QuietHostAssessment`
  fixture describing measured host LOAD, not a budget threshold.

_Round 3 (`assumption-audit`, blocking, fixed): the fourth entry was missing, and the list read
as a complete accounting without one. The omission changed no conclusion — that hit is unrelated
like the other three — but the record was silently assuming its own search was exhaustive, which
is what the Assumptions section's blanket "None" then rested on. The scope of the search is now
stated, and the count is given so the claim can be re-run._

**Judgement, not fact:** whether the `e2e/attestation` copy is IN SCOPE for this collapse is a design
question this record does not settle. What the record CAN cite is that the third copy is
self-contained by spec rather than by preference, and that the defect record's precondition names
only the two supervisor sites.

**Citations for both halves of that judgement:**

- `e2e/attestation/src/performanceContracts.ts:27-30` — "`SELF-CONTAINED BY SPEC, NOT BY
PREFERENCE. roadmap/15:38 places the supervisor idle-resource budget out of 15's scope in as many
words: "owned end-to-end by 05 … not a PerformanceContract, never routed through
\`packages/perf\`".`"
- `e2e/attestation/src/performanceContracts.ts:13-15` — "`roadmap/23 Exit criteria: "Performance
contracts satisfied rather than skipped, measured on a quiet host (15)"`" — the phase-23 release
  gate this module serves.
- `docs/evidence/criteria-closeout/defects/05-idle-budget-arm-not-calibrated-for-its-channel.md:236-238`
  — the precondition, quoted in full below, which names "BOTH sites" and does not mention
  `e2e/attestation`.

This record surfaces the third copy as a fact found by the search — it does not decide the scope.

_Round 4 (`assumption-audit`, blocking, fixed): this paragraph described what the
`e2e/attestation` module doc says without citing it, while the Assumptions section claimed
blanket citation coverage. Same rule as round 3, one paragraph over: an answered claim needs
its own citation or an entry under Assumptions._

**Citation for the precondition:**
`docs/evidence/criteria-closeout/defects/05-idle-budget-arm-not-calibrated-for-its-channel.md:236-238`
— "`0. **Whatever is chosen, apply it to BOTH sites and collapse the duplicated constant to one
exported value.** Two private copies of a threshold is how a remedy half-lands. This is a
precondition on the two options below, not a third option.`"

_Round 2 (`assumption-audit`, blocking, fixed): this record twice asserted what the defect
record says without citing it from inside this document, while the Assumptions section
claimed total citation coverage. The underlying claim was independently verified TRUE by the
reviewer; the gap was sourcing, not fact._

### q4 — Where should the shared constant live?

**Answer:** `packages/supervisor/src/idle-budget/` has exactly two non-test modules, both already
re-exported from the package barrel. This repository's dominant pattern — measured below, not
asserted — is to declare a shared constant once in a PRODUCTION module and import it from both the
sibling production module and the test. No `*.test.ts` file in this repository exports a constant.

**Directory enumeration, stated so the "exactly two" claim is checkable rather than implied:**
`ls packages/supervisor/src/idle-budget/` returns **5 files** — `heartbeat-scheduler.ts`,
`heartbeat-scheduler.test.ts`, `idle-budget.integration.test.ts`, `resource-probe.ts`,
`resource-probe.test.ts`. Three are `*.test.ts`; the remaining two are the non-test modules named
below. (Note the third test file, `resource-probe.test.ts`, which q1/q3 do not name because it
carries no copy of the threshold.)

**Search scope for the `*.test.ts` claim, stated for the same reason:**
`grep -rnE '^\s*export (const|let|var|\{)' --include=*.test.ts .` (excluding `node_modules/`,
`dist/`) returns **exactly one hit**, `packages/journal/src/layout/xdg-sole-definition.test.ts:146`,
which is text inside a template literal used as a fixture, not a module-level export. The
positive side of the pattern is not a single instance either:
`grep -rnE 'import \{[^}]*[A-Z][A-Z0-9_]{3,}[^}]*\} from "\./' --include=*.test.ts packages/ e2e/`
returns **104 hits** — test files importing an upper-case constant from a sibling production module.
**Counter-example kept rather than elided:** `packages/engine-core/src/footguns/mutation.test.ts`
exports eight `function`s (`:38`, `:46`, `:59`, `:81`, `:99`, `:122`, `:130`, `:147`). So the
narrow claim ("no test file exports a _constant_") survives the search; the broader claim ("test
files never export anything") does not, and is not made.

_Round 5 (`assumption-audit`, blocking, fixed — thirteen findings of one shape, plus three on the
directory count): this answer previously asserted "established pattern" and "never to export a
constant from a `*.test.ts` file" as settled repository-wide fact from a single positive prior-art
instance, and asserted "exactly two non-test modules" with no enumeration — the same defect class
round 3 fixed for q3's completeness claim, and the reason the Assumptions section's blanket "None"
could not stand beside it. Both claims are now backed by a stated, re-runnable search, and both
survived it._

**Citations:**

- `packages/supervisor/src/idle-budget/resource-probe.ts` and `.../heartbeat-scheduler.ts` — the only two non-test files in the directory, per the enumeration above.
- `packages/supervisor/src/index.ts:79-81` — "`// ---- Idle resource budget probe + heartbeat scheduler (WI6) ----`" / "`export * from "./idle-budget/resource-probe.js";`" / "`export * from "./idle-budget/heartbeat-scheduler.js";`"
- **Prior art, same directory, inside one of the two candidate homes** (round 5, `42499572`, blocking, fixed — this record previously reached three directories away for its prior art while an exact instance sat in the file it was recommending): `packages/supervisor/src/idle-budget/heartbeat-scheduler.ts:14` — "`export const HEARTBEAT_INTERVAL_MS = 5_000;`", consumed by its own production function at `:31` — "`const intervalMs = options.intervalMs ?? HEARTBEAT_INTERVAL_MS;`" — **and** by the sibling test `idle-budget.integration.test.ts:11` — "`import { createHeartbeatScheduler, HEARTBEAT_INTERVAL_MS } from "./heartbeat-scheduler.js";`", asserted at `:20` — "`expect(HEARTBEAT_INTERVAL_MS).toBe(5_000);`". This is the declare-in-production/import-in-sibling-test shape already live in the exact directory this change set edits, on the exact peer number (the 5 s heartbeat) of the threshold being collapsed.
- **Prior art, same package, different directory:** `packages/supervisor/src/runtime/xdg-supervisor-layout.ts:35` — "`export const SUPERVISOR_RUNTIME_DIR_MODE = 0o700;`" and `:38` — "`export const SUPERVISOR_SOCKET_MODE = 0o600;`", consumed by the sibling production module `runtime/runtime-dir.ts:28` **and** by `runtime/runtime-dir.test.ts:11` — "`import { SUPERVISOR_RUNTIME_DIR_MODE, SUPERVISOR_SOCKET_MODE } from "./xdg-supervisor-layout.js";`". A live, shipping instance of exactly the shape this change set needs.

### q5 — Does the barrel need to re-export it?

**Answer:** This repository excludes test-support-only modules from package barrels by explicit
doc-comment convention. A constant declared in an already-public production module is already
re-exported; a NEW module would need its own `export *` line to match the barrel's pattern.

**Citations:**

- `packages/gates/src/index.ts:8-11` — the test-support exclusion convention, naming `@crabgic/scheduler` and `@crabgic/supervisor` as mirrors.
- `packages/supervisor/src/index.ts:10-13` — this package's own statement of the same convention.

**Judgement, not fact:** which module the constant lands in is a design choice the barrel convention
constrains but does not dictate.

### q6 — What does the roadmap criterion say about the number?

**Answer:** The roadmap states the bound as `<1% of one core` in prose **three times**, in that exact
wording, all in `roadmap/05-supervisor-daemon.md`. It does not specify a decimal representation. It
**does** name the `CPU_BUDGET_FRACTION` identifier — once, at `:122`, inside the exit-criteria
checklist's recorded evidence, quoting the assertion rather than setting the number.

**Search scope, stated so both counts are checkable:** `grep -n "<1% of one core"
roadmap/05-supervisor-daemon.md` returns `:25`, `:51`, `:122`; `grep -rn "CPU_BUDGET"
roadmap/` returns exactly one line, `05-supervisor-daemon.md:122`.

**Citations:**

- `roadmap/05-supervisor-daemon.md:25` — "`**Idle resource budget:** <100 MiB RSS, <1% of one core, 5 s heartbeats; measured in CI with headroom`"
- `roadmap/05-supervisor-daemon.md:51` — the same bound restated as the phase exit criterion, "re-measured unchanged as a release gate by 23".
- `roadmap/05-supervisor-daemon.md:122` — the third occurrence, and the one naming the identifier: "`- [x] Idle budget test green with documented numbers (<100 MiB RSS, <1% of one core, 5 s heartbeat)`" … "`expect(cpuFraction).toBeLessThan(CPU_BUDGET_FRACTION);` (100 MiB / 0.01, `:14-15`)".

**Consequence for this change set, stated because it is not neutral:** `:122` cites
`idle-budget.integration.test.ts:14-15` **by line number** for the two budget constants. Collapsing
the constant moves those declarations, so that evidence line goes stale unless it is updated in the
same change set — exactly the failure mode `docs/verification-playbook.md:991` was written about.

_Round 5 (`assumption-audit`, blocking, fixed — findings `5842579d` and `60f13a2b`): this answer
said "twice" and "does not name a `CPU_BUDGET_FRACTION` identifier". Both were false, and the second
was a negative sub-claim carrying no citation of its own and no Assumptions entry. `:122` contains
both the third verbatim occurrence of the bound and the identifier. The corrected answer also
surfaces a real consequence the wrong one hid: a line-numbered citation into the file this change
set edits._

### q7 — Is there prior art for a duplicated-threshold collapse in this repo?

**Answer:** Yes — one directly analogous, already-shipped instance, in this same package.

**Citations:**

- `packages/supervisor/src/index.ts:15-23` — records that `SUPERVISOR_RUNTIME_DIR_MODE`/`SUPERVISOR_SOCKET_MODE` "had been declared in both `runtime/xdg-supervisor-layout.ts` and `runtime/runtime-dir.ts`" and were collapsed during phase 05's own build.
- The current source confirms the collapse held: `runtime-dir.ts:28` only imports them.

**Caveat, stated rather than elided:** that collapse was of a permission-mode constant, not a
budget-fraction threshold in two `*.test.ts` files. It establishes the PATTERN — collapse duplicate
declarations into one production-module export, have consumers import it — and nothing about this
value's calibration.

**The general rule this change set operationalizes**, and the source of the defect record's
precondition 0 cited under q3
(`docs/evidence/criteria-closeout/defects/05-idle-budget-arm-not-calibrated-for-its-channel.md:236-238`):
`docs/verification-playbook.md:991` — "`Grep
for every copy of a THRESHOLD, not just of`" a line number. Written directly about this same
`CPU_BUDGET_FRACTION` duplication, and the source of the defect record's precondition 0.

## Prior art

- `packages/supervisor/src/idle-budget/heartbeat-scheduler.ts:14` + `:31` + `idle-budget.integration.test.ts:11,20` — the shared-constant pattern, already live **in this change set's own directory**, on the 5 s heartbeat peer of the threshold being collapsed.
- `packages/supervisor/src/runtime/xdg-supervisor-layout.ts:35,38` + `runtime-dir.ts:28` + `runtime-dir.test.ts:11` — the same pattern, same package, different directory.
- `packages/supervisor/src/index.ts:15-23` — this package's own prior duplicate-constant collapse.
- `packages/gates/src/index.ts:8-11`, `packages/supervisor/src/index.ts:10-13` — the barrel exclusion convention.
- `docs/verification-playbook.md:991` — the "grep every copy of a threshold" rule.

## Assumptions

None — every claim above carries a citation opened and verified.

## What this record does NOT establish

- **Where** the collapsed constant should live — a design decision constrained by, not dictated by, q4/q5.
- **Whether** `e2e/attestation`'s independent `SUPERVISOR_IDLE_CPU_FRACTION_BUDGET` is in scope. The
  defect record's precondition 0 names only the two supervisor sites; this record surfaces the third
  copy as a fact, not as a scope ruling.
- **Anything about the value itself.** Per the change set's stated non-goal, this record does not
  investigate whether `0.01` is right — only where its declarations live.
