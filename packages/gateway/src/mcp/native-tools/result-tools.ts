/**
 * `result.submit` native tool — roadmap/16-gateway-core.md §In scope:
 * "natively registers... `result.submit`... wired to items 1-4" (dotted
 * form, interface-ledger Gap 8). Its own family under the 8-family count.
 *
 * Durable destination (this phase's own Risks section, applying the
 * identical rationale it gives for `evidence.attach`): "only need a
 * durable destination for a worker-submitted reference, which 04's
 * journal already supplies." A submitted result is modeled here as an
 * `EvidenceRecord`-shaped `evidence_pointer` entry tagged
 * `gateTag: "result.submit"` — the closed 13-member `JournalEntryType`
 * union (interface-ledger Gap 5) has no dedicated "worker result" member,
 * and 02's own text leaves the deeper supervisor-side artifact-store
 * relationship an open reconciler question (13's own flagged gap) that
 * this phase's exit criteria do not require answering.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, EvidenceRecordSchema, type EvidenceRecord } from "@eo/contracts";
import type { JournalStore } from "@eo/journal";
import type { AnyGatewayToolDefinition, GatewayToolDefinition } from "../tool-registry.js";

export interface ResultToolDeps {
  readonly journal: JournalStore;
}

const RESULT_SUBMIT_INPUT_SHAPE = {
  changeSetId: z.string(),
  workUnitId: z.string(),
  command: z.string(),
  exitStatus: z.number().int().nonnegative(),
  toolchainFingerprint: z.string(),
  artifactDigests: z.array(z.string()),
  objectId: z.string(),
};

export function buildResultTools(deps: ResultToolDeps): readonly AnyGatewayToolDefinition[] {
  const submit: GatewayToolDefinition<typeof RESULT_SUBMIT_INPUT_SHAPE> = {
    name: "result.submit",
    description: "Durably records a worker's submitted result reference (04's journal).",
    inputSchema: RESULT_SUBMIT_INPUT_SHAPE,
    handler: async (args) => {
      const record: EvidenceRecord = EvidenceRecordSchema.parse({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: randomUUID(),
        capturedAt: new Date().toISOString(),
        gateTag: "result.submit",
        ...args,
      });
      await deps.journal.appendEntry({
        type: "evidence_pointer",
        changeSetId: record.changeSetId,
        workUnitId: record.workUnitId,
        payload: record,
      });
      return { content: [{ type: "text", text: JSON.stringify({ submitted: true, id: record.id }) }] };
    },
  };

  return [submit];
}
