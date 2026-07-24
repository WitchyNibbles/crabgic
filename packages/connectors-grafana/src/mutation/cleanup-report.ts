import type { RemoteMutationPlan } from "@eo/contracts";
import type { MutationPipelineOutcome } from "@eo/gateway";
import { parseCanonicalTarget } from "./canonical-target.js";

/**
 * roadmap/20-grafana-adapters.md §In scope, "Mutation safety": "created
 * resources are never auto-deleted on failure — reported for reviewed
 * cleanup instead." This module produces exactly that report; it has no
 * delete capability of its own (no method here issues, or could issue, a
 * DELETE call — the public resource-client surface has no delete method
 * to call in the first place, see `../security/no-delete-admin.test.ts`).
 */
export interface GrafanaCleanupReport {
  readonly planId: string;
  readonly kind: string;
  readonly canonicalTarget: string;
  readonly reason: string;
  readonly detectedAt: string;
}

/**
 * Builds a cleanup-report artifact for a failed CREATE plan. Returns
 * `undefined` when there is nothing to clean up (the plan wasn't a create,
 * or it actually succeeded/replayed) — never fabricates a report for a
 * plan that didn't need one.
 */
export function buildCleanupReportForFailedCreate(
  plan: RemoteMutationPlan,
  outcome: MutationPipelineOutcome,
  now: () => Date = () => new Date(),
): GrafanaCleanupReport | undefined {
  if (plan.action !== "create") return undefined;
  if (outcome.status === "recorded" || outcome.status === "replayed") return undefined;

  const { kind } = parseCanonicalTarget(plan.canonicalTarget);
  return {
    planId: plan.id,
    kind,
    canonicalTarget: plan.canonicalTarget,
    reason: outcome.detail ?? `create did not complete (status: ${outcome.status})`,
    detectedAt: now().toISOString(),
  };
}
