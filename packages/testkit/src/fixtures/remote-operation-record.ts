import {
  CURRENT_SCHEMA_VERSION,
  RemoteOperationRecordSchema,
  type RemoteOperationRecord,
} from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `RemoteOperationRecord` fixture builder — roadmap/02 work item 10. */
export function buildRemoteOperationRecord(
  overrides: Partial<RemoteOperationRecord> = {},
): RemoteOperationRecord {
  const ctx = createFixtureContext();
  const defaults: RemoteOperationRecord = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    remoteMutationPlanId: ctx.ids.next(),
    operationId: "deterministic-fixture-operation-id",
    contentHash: "sha256:deterministic-fixture-content-hash",
    status: "pending",
    recordedAt: ctx.clock.next(),
  };
  return RemoteOperationRecordSchema.parse({ ...defaults, ...overrides });
}
