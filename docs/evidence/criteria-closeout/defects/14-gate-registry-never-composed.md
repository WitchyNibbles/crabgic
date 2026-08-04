# Defect 14-gate-registry-never-composed

**Phase:** 14 — Quality & security verification gates (`roadmap/14-quality-security-gates.md`) —
the registry and its firing primitives. Also affects **15** (`createPerformanceGateHandler`) and
**24** (`registerCriteriaSealGate`, exit criterion 7's disclosed note).

**Found:** 2026-08-04, while fixing
`defects/24-daemon-requirements-registry-unwired.md`, at `3dec9bf2caa6b94bd817aee414f9458c37750fd9`.

**Severity:** systemic. Not a wiring miss in any one phase — the stage the gates fire at is
unreachable in production, so there is nowhere for a `register…Gate` call to be _put_ that would
run.

## Gap

`packages/gates` builds a complete gate registry: registration by risk tag, `fireByTag`, `fireAll`,
`fireOne` → `emitEvidence` → a schema-valid `EvidenceRecord` journaled as an `evidence_pointer`.
Gate handlers register into it from three packages. **Not one of them is registered by production
code, because no production code ever creates a registry, and no production code ever reaches the
stage they fire at.**

Three facts, each measured by grep over `packages/*/src` and `e2e/` with `node_modules` and `dist`
excluded, at the sha above.

1. **`createGateRegistry` has zero production call sites.** Every hit outside its own definition
   (`packages/gates/src/registry.ts:47`) and its barrel export (`packages/gates/src/index.ts:25`)
   is a `*.test.ts` file. `packages/perf/src/gate/performance-gate.ts:92`'s doc comment says the
   perf gate is "Registered via `@crabgic/gates`' PUBLIC `createGateRegistry`" — by nobody.

2. **`fireAll` and `fireByTag` have zero production callers.** The single non-test caller of
   `fireAll` anywhere is `packages/gates/src/final-candidate.ts:50`, inside
   `fireFinalCandidateVerification` — and that function has zero callers outside `packages/gates`
   itself (grep for `fireFinalCandidateVerification|allGatesPassed` over `packages/`, `e2e/`,
   `scripts/`, excluding `packages/gates/`, returns nothing). It is exported and never used.

3. **The decisive one: no code anywhere transitions a run to `verifying`, `integrating` or
   `final_verifying`.** `grep -rn 'to: "verifying"|to: "integrating"|to: "final_verifying"'` over
   `packages/` and `e2e/` returns **zero hits — including in tests**. The states exist in
   `packages/contracts/src/state-machines/run-lifecycle.ts:53-55` and are named in membership
   lists elsewhere, but nothing ever moves a run onto those edges.
   `packages/cli/src/daemon/run-dispatcher.ts:714-716` leaves a `completed` drive `running` on
   purpose and says so: `verifying` is "owned by the verification pipeline rather than invented
   here" (`:693-697`), "a deferral, not a dead end" (`:927`).

Together: `GateContext.stage` is typed `"verifying" | "final_verifying"`
(`packages/gates/src/types.ts:14`), and production never produces a run in either state. There is
also no integrated-candidate `objectId` to hand a `GateContext`, because integration orchestration
(phase 08's output) is not composed either.

## Why this was not fixed alongside the phase-24 defect

Registering `registerCriteriaSealGate` into a registry that nothing ever fires would produce
exactly the harness-only vacuity the criteria-closeout effort exists to catch: a call site that
adds a handler to an object with no reader, provable by deleting it and watching zero suites
redden. It would also falsely discharge criterion 7's disclosed note, which correctly says "no
production composition root registers this gate yet".

The phase-24 fix that ships alongside this record closes the **per-unit completion funnel** (the
requirements registry seam), which is a genuinely reachable path. The final gate is a different
and larger piece of work.

## What the remedy actually requires

Not a one-line `register` call. In dependency order:

1. A **post-completion pipeline** owning the walk from `running` through `verifying` and
   `integrating` to `final_verifying` — including the first edge, which the dispatcher
   deliberately declines to invent.
2. An **integrated-candidate object id** for `GateContext.objectId`, which means composing phase
   08's integration output.
3. A **composition root** that builds one `GateRegistry`, registers 14's own handlers plus 15's
   perf gate and 24's seal gate, and fires it at the right stage — and that must live where the
   daemon can reach it, with the same "one shared instance, never a second copy" discipline
   `composeSupervisor` already applies to registries and `liveWorkers`.
4. Tests that go through that composition root, not through a hand-built registry — the lesson of
   `defects/24-daemon-requirements-registry-unwired.md`, where a full set of green harness suites
   coexisted with a completely inert production path.

## Scope of the claim

This record says the gate machinery is **unreached in production**. It does **not** say the gates
are wrong: `packages/gates`' own suites are real and non-vacuous, and phase 24's criterion 7 is
evidenced at gate-harness level exactly as its own criterion names. What is missing is a consumer.

**Effort:** L. **Needs CI:** no (ordinary in-repo work). **Needs live engine:** no.
**Needs owner input:** yes — this is a scope decision (when the verification/integration pipeline
gets built), not a bug to slot into a maintenance pass.

**Ticket-ready:** yes, as an epic; it needs its own plan, not this one.
