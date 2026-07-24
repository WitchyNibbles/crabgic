import {
  CURRENT_SCHEMA_VERSION,
  RemoteMutationPlanSchema,
  type RemoteMutationPlan,
} from "@eo/contracts";
import type { GrafanaResourceKind } from "../resource-kinds.js";
import { hashCanonicalFields } from "../resources/resource-definitions.js";
import { buildCanonicalTarget } from "./canonical-target.js";
import { requiredHighImpactFlagsFor } from "./high-impact-tagging.js";

export interface BuildGrafanaMutationPlanInput {
  readonly id: string;
  readonly externalConnectionId: string;
  readonly tenant: string;
  readonly kind: GrafanaResourceKind;
  readonly action: "create" | "update";
  /** The resource's own identifier — a deterministic uid for `create` (never server-assigned yet), the existing `externalId` for `update`. */
  readonly canonicalId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  /** Required for `update` (the precondition token this plan's optimistic-concurrency write is conditioned on); absent for `create`. */
  readonly expectedRemoteRevision?: string;
  readonly envelopeId: string;
  readonly redactedDiff: string;
}

/**
 * Builds a Grafana `RemoteMutationPlan` — roadmap/20 §Interfaces produced:
 * "each carrying its canonical target, action, required
 * `HighImpactCapabilityFlag` member(s) where applicable, desired-state
 * hash, and expected remote revision." `impactClass`/`rollbackClass` follow
 * roadmap/20 §In scope's mutation-safety rule verbatim: creates are never
 * auto-deleted on failure (cleanup-report only); updates get a
 * version-checked restore path (`../mutation/rollback.js`).
 */
export function buildGrafanaMutationPlan(input: BuildGrafanaMutationPlanInput): RemoteMutationPlan {
  const requiredCapabilityFlags = requiredHighImpactFlagsFor(input.kind, input.action, input.input);

  const plan: RemoteMutationPlan = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: input.id,
    externalConnectionId: input.externalConnectionId,
    tenant: input.tenant,
    canonicalTarget: buildCanonicalTarget(input.kind, input.canonicalId),
    action: input.action,
    ...(requiredCapabilityFlags.length > 0 ? { requiredCapabilityFlags } : {}),
    redactedDiff: input.redactedDiff,
    desiredStateHash: hashCanonicalFields(input.input),
    idempotencyKey: input.idempotencyKey,
    ...(input.expectedRemoteRevision !== undefined
      ? { expectedRemoteRevision: input.expectedRemoteRevision }
      : {}),
    impactClass: input.action === "create" ? "irreversible-create-no-auto-delete" : "reversible",
    rollbackClass: input.action === "create" ? "cleanup-report-only" : "version-checked-restore",
    envelopeId: input.envelopeId,
  };
  return RemoteMutationPlanSchema.parse(plan);
}
