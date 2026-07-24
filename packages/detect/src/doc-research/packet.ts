/**
 * `DocResearchPacket` — roadmap/12 §In scope, "Doc-research task-packet
 * generator" bullet: "consumed by phase 11's manager-session contract/DAG
 * drafting flow ... when available; graceful degradation before 12,
 * mirroring 11's existing stack-detection relationship." This is this
 * phase's OWN minimal-sufficient shape — no upstream schema pins a
 * "doc-research packet" (unlike `TaskPacket`, 02, which is 13's dispatch
 * unit for a WorkUnit attempt and requires fields — `workUnitId`,
 * `baseObjectId`, `resourceLimits`, `resultSchema` — that have no meaning
 * for a research request that never dispatches an engine attempt at all).
 * Locally zod-validated (CLAUDE.md: "validate at system boundaries")
 * rather than executed/interpreted in any way.
 */
import { z } from "zod";
import { NonEmptyStringSchema } from "@eo/contracts";

export const DocResearchPacketInputSchema = z
  .object({
    topic: NonEmptyStringSchema,
    objective: NonEmptyStringSchema,
    queries: z.array(NonEmptyStringSchema).min(1),
    sourcePaths: z.array(NonEmptyStringSchema),
  })
  .strict();
export type DocResearchPacketInput = z.infer<typeof DocResearchPacketInputSchema>;

export const DocResearchPacketSchema = DocResearchPacketInputSchema.extend({
  createdAt: NonEmptyStringSchema,
}).strict();
export type DocResearchPacket = z.infer<typeof DocResearchPacketSchema>;

export function buildDocResearchPacket(
  input: DocResearchPacketInput,
  clock: () => string = () => new Date().toISOString(),
): DocResearchPacket {
  const validated = DocResearchPacketInputSchema.parse(input);
  return DocResearchPacketSchema.parse({ ...validated, createdAt: clock() });
}
