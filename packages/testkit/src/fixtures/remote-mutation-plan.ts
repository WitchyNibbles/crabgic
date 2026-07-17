import {
  CURRENT_SCHEMA_VERSION,
  RemoteMutationPlanSchema,
  type RemoteMutationPlan,
} from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `RemoteMutationPlan` fixture builder — roadmap/02 work item 10. */
export function buildRemoteMutationPlan(
  overrides: Partial<RemoteMutationPlan> = {},
): RemoteMutationPlan {
  const ctx = createFixtureContext();
  const defaults: RemoteMutationPlan = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    externalConnectionId: ctx.ids.next(),
    tenant: "example-tenant",
    canonicalTarget: "issue:EXAMPLE-1",
    action: "transition",
    redactedDiff: "status: To Do -> In Progress",
    desiredStateHash: "sha256:deterministic-fixture-desired-state-hash",
    idempotencyKey: "deterministic-fixture-idempotency-key",
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId: ctx.ids.next(),
  };
  return RemoteMutationPlanSchema.parse({ ...defaults, ...overrides });
}
