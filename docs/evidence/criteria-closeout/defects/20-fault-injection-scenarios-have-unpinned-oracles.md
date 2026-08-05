# 20 — the fault-injection scenarios' own verdicts are unpinned

**Phase:** 20 — Grafana Cloud/OSS/Enterprise adapters
(`roadmap/20-grafana-adapters.md`)

**Found:** 2026-08-05, by adversarial review of PR #94 (attack G).

## Gap

PR #94 replaced phase 21's tautological tenant-boundary gate with one that drives phase 20's real
`tenantBoundaryBreachScenario`. That fix is sound at the gate layer — but it exposed a gap one layer
down.

**Measured:** mutating the scenario's own verdict inside its closure —

```ts
passed: result.ok === false   →   passed: true
```

— leaves `packages/gates` **and** `packages/connectors-grafana` fully green: **83 files / 660 tests**.

The gate is a faithful reporter of whatever the scenario concludes, so its refusal-detecting power
rides entirely on the scenario's integrity, and **nothing per-push pins that direction.**

## Why the cheap pins do not work

Considered and rejected, each for a measured reason:

- **Re-asserting `passed === true`** is what `fault-injection.test.ts` already does — it is the
  mutation's own target.
- **Tying `passed` to `detail`** (`expect(r.passed).toBe(r.detail === "refused as expected")`) only
  bites once enforcement _also_ regresses.
- The real blocker: `tenantBoundaryBreachScenario` has **no seam**. `orgId 999` and allowlist `["7"]`
  are hardcoded in the closure, so no test can construct a world where the scenario _ought_ to fail.

## Remedy

**S–M.** Give the scenario an **optional injected doctor defaulting to the real
`checkGrafanaConnectionDoctor`** — the same shape as `grafanaTenantBoundaryVerify(scenarios?, doctor?)`
already proven in PR #94 — then add one reverse probe to `fault-injection.test.ts`: inject a doctor
returning `ok: true` and assert the scenario reports `passed: false`. A constant-`true` `passed` dies
immediately under that assertion.

Four constraints established during review:

1. **The seam must be on the production `run()` path** (optional param or factory), not a test-local
   re-implementation — otherwise it is harness-only reach in a new coat.
2. **The residual moves, it does not vanish**: a rewired _default_ argument still survives the reverse
   probe. Document that in-file, exactly as PR #94 documented its own equivalent limitation.
3. **Signature ripple:** gates' `grafanaTenantBoundaryVerify` loop calls `scenario.run()` zero-arg, and
   the stub `run: async () => …` must stay type-valid. An optional parameter is compatible, but check
   `FaultInjectionScenario` for interface-ledger exposure before widening — PR #94's plan verified zero
   tenant/manifest rulings, but the `run` signature itself was not part of that check.
4. `forgedDeleteAdminScenario` and `redactionCheckScenario` share the same unpinned-oracle shape and
   want the same treatment.

Useful symmetry to preserve: gates' T6 pins **always-refuse** at the gate layer; this probe pins
**always-accept** at the scenario layer. Together they bracket the oracle from both sides.

Needs no live engine, no Docker and no owner subscription.
