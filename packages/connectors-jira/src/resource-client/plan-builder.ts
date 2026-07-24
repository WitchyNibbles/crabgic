import { createHash, randomUUID } from "node:crypto";
import {
  CURRENT_SCHEMA_VERSION,
  RemoteMutationPlanSchema,
  type HighImpactCapabilityFlag,
  type RemoteMutationPlan,
} from "@eo/contracts";
import { assertAllowedJiraOperation } from "../security/preflight-capability-guard.js";
import type { JiraAction } from "./actions.js";
import type { JiraPlanPayloadRegistry } from "./plan-payload-registry.js";

/** Deterministic content hash for a plan's desired-state payload — the `desiredStateHash` half of 04's `(operationId, contentHash)` idempotency key. */
export function computeDesiredStateHash(payload: unknown): string {
  const stable = JSON.stringify(payload);
  return `sha256:${createHash("sha256").update(stable).digest("hex")}`;
}

/** Shared per-connection context every `plan*` builder closes over — bundled into one object so adding a new field never churns every builder's positional-argument list. */
export interface JiraPlanBuildContext {
  readonly tenant: string;
  readonly externalConnectionId: string;
  /** Where this plan's real (un-redacted) desired-state payload is staged for apply-time reconstruction — see `./plan-payload-registry.ts`'s doc comment. */
  readonly payloadRegistry: JiraPlanPayloadRegistry;
}

export interface BuildJiraMutationPlanInput extends JiraPlanBuildContext {
  readonly canonicalTarget: string;
  readonly action: JiraAction;
  readonly redactedDiff: string;
  readonly desiredStatePayload: unknown;
  readonly idempotencyKey: string;
  readonly expectedRemoteRevision?: string;
  readonly impactClass: "reversible" | "irreversible";
  readonly rollbackClass: string;
  readonly envelopeId: string;
  readonly requiredCapabilityFlags?: readonly HighImpactCapabilityFlag[];
}

/**
 * Builds and schema-validates a `RemoteMutationPlan` — the ONE call site
 * every `plan*` method in `./jira-resource-client.ts` funnels through.
 * Runs `assertAllowedJiraOperation` FIRST (roadmap/18 §Test plan,
 * Security bullet) — a forged/out-of-scope action never reaches even
 * plan CONSTRUCTION, let alone network I/O. Pure and local: no I/O of its
 * own, matching `JiraResourceClient`'s own "planning is local-only" rule.
 */
export function buildJiraMutationPlan(input: BuildJiraMutationPlanInput): RemoteMutationPlan {
  assertAllowedJiraOperation(input.action);

  const plan: RemoteMutationPlan = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    externalConnectionId: input.externalConnectionId,
    tenant: input.tenant,
    canonicalTarget: input.canonicalTarget,
    action: input.action,
    redactedDiff: input.redactedDiff,
    desiredStateHash: computeDesiredStateHash(input.desiredStatePayload),
    idempotencyKey: input.idempotencyKey,
    impactClass: input.impactClass,
    rollbackClass: input.rollbackClass,
    envelopeId: input.envelopeId,
    ...(input.expectedRemoteRevision !== undefined
      ? { expectedRemoteRevision: input.expectedRemoteRevision }
      : {}),
    ...(input.requiredCapabilityFlags !== undefined && input.requiredCapabilityFlags.length > 0
      ? { requiredCapabilityFlags: input.requiredCapabilityFlags }
      : {}),
  };
  const validated = RemoteMutationPlanSchema.parse(plan);
  input.payloadRegistry.put(validated.id, input.desiredStatePayload);
  return validated;
}
