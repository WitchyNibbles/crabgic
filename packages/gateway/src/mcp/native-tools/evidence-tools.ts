/**
 * `evidence.get`/`evidence.attach` native tools — roadmap/16-gateway-
 * core.md §In scope: "natively registers... `evidence.get`,
 * `evidence.attach`... wired to items 1-4." One family (grouped under one
 * top-level prefix, interface-ledger Gap 1) of the 8-family MCP tool
 * surface.
 *
 * Durable destination: 04's journal (`evidence_pointer` `JournalEntryType`
 * entries, payload = 02's `EvidenceRecordSchema` verbatim) — this phase's
 * own Risks section: "`evidence.attach`/`result.submit` only need a
 * durable destination for a worker-submitted reference, which 04's
 * journal already supplies."
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, EvidenceRecordSchema, type EvidenceRecord } from "@eo/contracts";
import type { JournalStore } from "@eo/journal";
import type { AnyGatewayToolDefinition, GatewayToolDefinition } from "../tool-registry.js";

export interface EvidenceToolsDeps {
  readonly journal: JournalStore;
}

const EVIDENCE_ATTACH_INPUT_SHAPE = {
  changeSetId: z.string(),
  command: z.string(),
  exitStatus: z.number().int().nonnegative(),
  toolchainFingerprint: z.string(),
  artifactDigests: z.array(z.string()),
  objectId: z.string(),
  requirementId: z.string().optional(),
  workUnitId: z.string().optional(),
  gateTag: z.string().optional(),
};

const EVIDENCE_GET_INPUT_SHAPE = {
  changeSetId: z.string(),
};

async function persistEvidenceRecord(
  journal: JournalStore,
  record: EvidenceRecord,
): Promise<void> {
  await journal.appendEntry({
    type: "evidence_pointer",
    changeSetId: record.changeSetId,
    ...(record.workUnitId !== undefined ? { workUnitId: record.workUnitId } : {}),
    payload: record,
  });
}

export function buildEvidenceTools(deps: EvidenceToolsDeps): readonly AnyGatewayToolDefinition[] {
  const attach: GatewayToolDefinition<typeof EVIDENCE_ATTACH_INPUT_SHAPE> = {
    name: "evidence.attach",
    description: "Durably attaches a worker-submitted EvidenceRecord to a ChangeSet (04's journal).",
    inputSchema: EVIDENCE_ATTACH_INPUT_SHAPE,
    handler: async (args) => {
      const record = EvidenceRecordSchema.parse({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: randomUUID(),
        capturedAt: new Date().toISOString(),
        ...args,
      });
      await persistEvidenceRecord(deps.journal, record);
      return { content: [{ type: "text", text: JSON.stringify({ attached: true, id: record.id }) }] };
    },
  };

  const get: GatewayToolDefinition<typeof EVIDENCE_GET_INPUT_SHAPE> = {
    name: "evidence.get",
    description: "Retrieves every EvidenceRecord attached to a ChangeSet.",
    inputSchema: EVIDENCE_GET_INPUT_SHAPE,
    handler: async (args) => {
      const records: EvidenceRecord[] = [];
      for await (const entry of deps.journal.queryEntries({ type: "evidence_pointer" })) {
        if (entry.type === "evidence_pointer" && entry.payload.changeSetId === args.changeSetId) {
          records.push(entry.payload);
        }
      }
      return { content: [{ type: "text", text: JSON.stringify({ records }) }] };
    },
  };

  return [attach, get];
}
