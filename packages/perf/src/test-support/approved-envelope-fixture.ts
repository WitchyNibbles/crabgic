/**
 * Test-support-only helper (not part of this package's public barrel, exactly
 * like `./journal-anchor-fixture.ts` beside it) — builds the APPROVED
 * `AuthorizationEnvelope` a gate firing resolves server-side, bound to a given
 * provisional `PerformanceContract`'s `budgetHash`.
 *
 * Interface-ledger Gap 22 (2026-08-06): 11's intake derives
 * `envelope.provisionalBudgetHash` from the same `hashProvisionalBudgets` call
 * that stamps the provisional contract, so "an envelope approved for THIS
 * budget set" is exactly an envelope whose binding equals that contract's
 * `budgetHash`. Built through `@crabgic/testkit`'s real fixture builder, which
 * `AuthorizationEnvelopeSchema.parse`s its output — so these fixtures exercise
 * the real schema (including the member's optionality) rather than a
 * hand-shaped literal that could drift from it.
 *
 * `bindingOverride` exists for the fail-closed cases: pass `undefined` to model
 * the legacy, unbound envelope, or another hash to model an approval rendered
 * over a different budget set.
 */
import type { AuthorizationEnvelope, ProvisionalPerformanceContract } from "@crabgic/contracts";
import { buildAuthorizationEnvelope } from "@crabgic/testkit";

export function approvedEnvelopeFor(
  provisional: ProvisionalPerformanceContract,
  bindingOverride?: { readonly provisionalBudgetHash: string | undefined },
): AuthorizationEnvelope {
  const binding =
    bindingOverride === undefined ? provisional.budgetHash : bindingOverride.provisionalBudgetHash;
  return buildAuthorizationEnvelope({
    changeSetId: provisional.changeSetId,
    ...(binding !== undefined ? { provisionalBudgetHash: binding } : {}),
  });
}
