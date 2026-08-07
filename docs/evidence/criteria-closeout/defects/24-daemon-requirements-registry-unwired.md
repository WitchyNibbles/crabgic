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

## Remedied by PR #85, 2026-08-04 — the requirements seam only

Everything above is left verbatim; this section is appended, not merged into it. The fix landed in
`6a62729` ("fix(supervisor,cli): wire the requirements registry into the daemon and make its
omission unexpressible") and was recorded here late — this addendum is the record catching up with
the code, added by the wave-close integrator pass.

Three changes, and the third is the one that matters most:

1. **The daemon composes the registry.** `packages/supervisor/src/compose/compose-supervisor.ts:191`
   builds it from `REQUIREMENTS_FILE_NAME` under the state root and `:228` passes it into the
   dependency bundle. The `:81` doc comment that this record quoted as describing an intent rather
   than the code now carries a dated annotation at `:83` saying so in its own words.

2. **Omission is unexpressible, not merely unlikely.**
   `packages/supervisor/src/router/build-router.ts:89` declares
   `readonly requirements: Registry<Requirement>;` — no longer optional, so a composition root that
   forgets it fails to compile. This closes the exact escape this record identified: "Requiredness at
   a call site does not survive an optional field on the dependency bundle that feeds it."

3. **Resolution is strict, because wiring alone would not have sufficed.** The ternary this record
   quoted has been replaced by `resolveRequirementsStrict`
   (`packages/supervisor/src/registries/requirements-registry.ts:98-112`) at
   `packages/cli/src/daemon/run-dispatcher.ts:594` and `:696`. A registry that tolerates an absent
   or incomplete file would still hand back `[]` for a declared id and reproduce this defect exactly
   — silently, and with the compile-time guarantee in (2) satisfied. Instead `:110` throws
   `UnresolvedRequirementError` when any declared id resolves to no record, so an incoherent
   acceptance basis fails loudly rather than verifying nothing.

### What this does NOT discharge

**Criterion 7's gate gap is untouched by this fix.** `registerCriteriaSealGate` still has no
production call site, because nothing in production creates a gate registry or moves a run into
`verifying`/`final_verifying` at all. That is the other half of the seam this record's
"phase-level pattern" section named, and it is filed separately as
`docs/evidence/criteria-closeout/defects/14-gate-registry-never-composed.md`, which records why
registering the gate into a registry nothing fires would be harness-only vacuity rather than a fix.

So phase 24's enforcement is no longer inert in the shipped daemon on the **per-unit completion
funnel**; the **final gate** remains unreached.

## Second addendum 2026-08-07 — this record's closing claim is superseded

The sentence in the earlier addendum that nothing in production creates a gate registry or moves a
run into `verifying`/`final_verifying` at all was true when written and is **superseded by PR #104**
(and extended by PR #121). The daemon's composition root now builds a gate registry and the
post-completion pipeline walks a completed run through `verifying`, `integrating`,
`final_verifying` and on to `published_local`; since PR #121 the security-fixture manifest's gates
fire blocking at `final_verifying` for every run. Evidence:
`docs/evidence/phase-14/gate-composition-security-manifest-batchM.txt`.

The requirements half of this record stands exactly as recorded. Criterion 7's gate gap is no longer
this record's to carry — it now lives under `14-gate-registry-never-composed`, whose amended text
states which gates fire and which remain unregistered, and why each of the latter is a measured
necessity rather than an oversight. Nothing here is re-classified: this is a pointer correction so a
reader does not act on a claim the tree has moved past.
