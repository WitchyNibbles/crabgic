# 24 — the daemon composes no requirements registry, so seal verification resolves zero requirements

**Phase:** 24 — Requirements, approval seals and the completion funnel
(`roadmap/24-sealed-acceptance-criteria.md`, exit criteria 5 and 6)

**Criterion 5 (verbatim):**

> The headline tamper fixture: post-approval criteria edit → completion is never recorded `succeeded`; `failed` is recorded and the typed reason (`self_consistency_mismatch` or `approval_seal_mismatch`) is journaled (integration test).

**Criterion 6 (verbatim):**

> Rollback to a previously-approved criteria set after re-approval is blocked by latest-seal-wins (integration test).

**Found:** 2026-08-02, criteria-closeout adversarial review of PR #81, at `783fe6e`.

## Gap

Criteria 5 and 6 remain **ticked** — each names an integration test as its evidence channel, and
those tests are real, non-vacuous and re-verified during this pass. What does **not** hold is the
stronger claim the pass attached to criterion 6's citation on
`packages/cli/src/daemon/run-dispatcher.ts:561-567`:

> "The read path the integration test deliberately reuses, so 'blocked' means blocked in production
> and not only in a fixture"

In the shipped daemon composition, seal verification resolves an **empty** requirement set for
every work unit. The quoted fragment skipped lines 562-565 — the branch that voids it — from the
middle of its own cited span.

## The chain

`packages/cli/src/daemon/run-dispatcher.ts:561-567`:

```ts
resolveCriteriaSeal: async (ctx) => ({
  requirements:
    deps.requirements === undefined
      ? []
      : resolveRequirements(deps.requirements, ctx.workUnit.requirementIds),
  approvalSeal: await findLatestCriteriaSeal(deps.journal, changeSet.id),
}),
```

1. `SupervisorDependencies.requirements` is **optional** —
   `packages/supervisor/src/router/build-router.ts:73` declares
   `readonly requirements?: Registry<Requirement>`.
2. `composeSupervisor` (`packages/supervisor/src/compose/compose-supervisor.ts`) **never builds
   one.** It declares the filename constant at `:79` —

   > `/** The Requirement records (roadmap/24). Unlike the contract above, the DAEMON is a reader: seal verification resolves a work unit's requirements before it will accept that unit's completion. */`

   — and then never opens that file. The constant's only consumer is
   `packages/cli/src/bootstrap.ts:471`, which builds the registry in the **intake** process.

3. The daemon reaches the dispatcher only through
   `packages/cli/src/bin/supervisord.ts:71` → `bootSupervisor` → `composeSupervisor`
   (`packages/supervisor/src/compose/boot-supervisor.ts:141`, `config.compose ?? composeSupervisor`).
   No other production dispatcher composition exists.
4. So `deps.requirements` is always `undefined` there, and the ternary always yields `[]`.
5. `packages/scheduler/src/executor.ts:118` accepts an empty presented set **by design** — "Empty is
   legitimate — a chore unit owns none" — so nothing downstream objects.

**Measured.** A scoped probe (written for the review, not committed) ran `dispatchAttempt` with
`requirements: []` plus a live approval seal naming a requirement: result `succeeded`, **zero
refusals**.

`packages/cli/src/daemon/run-dispatcher.test.ts` contains no reference to `resolveCriteriaSeal` or
to requirements, so no existing test observes this.

`packages/cli/src/bootstrap.ts:466-469`'s comment — "the daemon itself reads these … that happens in
the process that drives the run, not the one that took the intake" — states the intended design and
is false in effect.

## The phase-level pattern

This is the second half of one seam, and the phase file warns about exactly this shape **twice**
("one path threaded it, the daemon path did not"):

- **Criterion 7 (already disclosed in this pass's own notes):** `registerCriteriaSealGate` has no
  production call site; nothing calls `createGateRegistry` in production at all.
- **Criterion 6 (this record):** the requirements registry is never composed into the daemon.

Together they mean phase 24's enforcement is **inert in the shipped daemon**: the completion funnel
verifies zero requirements for every work unit, and the final gate is unregistered.

Criterion 8 made the parameter **required** at the scheduler — and the optionality reappeared one
layer up, at the composition root. Requiredness at a call site does not survive an optional field on
the dependency bundle that feeds it.

## Remedy

**M** — wire the requirements registry into `composeSupervisor` alongside the registries it already
builds, and consider making `SupervisorDependencies.requirements` non-optional so the composition
root cannot silently omit it again. Add a dispatcher-level test that observes a non-empty resolved
requirement set. Separately, register the criteria-seal gate in production (criterion 7's note).

Needs no live engine, no Docker and no owner subscription — this is ordinary in-repo wiring work.

Out of scope for a criteria-closeout pass, which files defects rather than fixing them.
