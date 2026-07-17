import {
  CURRENT_SCHEMA_VERSION,
  PerformanceContractSchema,
  type ProvisionalPerformanceContract,
} from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/**
 * Deterministic `PerformanceContract` fixture builder — roadmap/02 work
 * item 10. `PerformanceContract` is a discriminated union of two variants
 * (`provisional` | `enforced`, see `../../contracts/src/contracts/
 * performance-contract.ts`); this builder's default output is the
 * `provisional` variant (the earlier-lifecycle instance 11 creates at
 * approval-preview time) — a deliberate, documented choice so the registry
 * carries exactly one builder per contract (roadmap/02 exit criterion:
 * "Testkit fixture builders exist for all 21 contracts"), while still
 * validating against the full `PerformanceContractSchema` union (either
 * variant satisfies it).
 */
export function buildPerformanceContract(
  overrides: Partial<ProvisionalPerformanceContract> = {},
): ProvisionalPerformanceContract {
  const ctx = createFixtureContext();
  const defaults: ProvisionalPerformanceContract = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    changeSetId: ctx.ids.next(),
    createdAt: ctx.clock.next(),
    budgetSource: "requirement_acceptance_criteria",
    variant: "provisional",
    budgets: [{ metric: "latency", threshold: 200, unit: "ms" }],
    budgetHash: "sha256:deterministic-fixture-budget-hash",
  };
  return PerformanceContractSchema.parse({
    ...defaults,
    ...overrides,
  }) as ProvisionalPerformanceContract;
}
