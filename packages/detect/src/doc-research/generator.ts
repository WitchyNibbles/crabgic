/**
 * `generateDocResearchPacket` — roadmap/12 exit criterion: "Doc-research
 * task-packet generator degrades gracefully when invoked before phase
 * 11's drafting flow exists (typed fallback, no crash)." `consumer` is
 * phase 11's manager-session contract/DAG drafting flow, injected as a
 * port — this package never imports anything from a not-yet-built phase
 * 11 package. Omitting it (the only possibility before 11 lands) yields a
 * typed `degraded` result carrying the packet itself, never a throw.
 */
import {
  buildDocResearchPacket,
  type DocResearchPacket,
  type DocResearchPacketInput,
} from "./packet.js";

export interface DocResearchConsumer {
  /** Phase 11's own submission entry point, once it exists. Return value is opaque to this package. */
  submit(packet: DocResearchPacket): unknown | Promise<unknown>;
}

export interface GenerateDocResearchPacketOptions {
  readonly consumer?: DocResearchConsumer;
  readonly clock?: () => string;
}

export type DocResearchGenerationResult =
  | {
      readonly status: "submitted";
      readonly packet: DocResearchPacket;
      readonly consumerResult: unknown;
    }
  | { readonly status: "degraded"; readonly packet: DocResearchPacket; readonly reason: string };

export async function generateDocResearchPacket(
  input: DocResearchPacketInput,
  options: GenerateDocResearchPacketOptions = {},
): Promise<DocResearchGenerationResult> {
  const packet = buildDocResearchPacket(input, options.clock);

  if (options.consumer === undefined) {
    return {
      status: "degraded",
      packet,
      reason:
        "phase 11's manager-session contract/DAG drafting flow is not available yet — packet generated but not submitted anywhere",
    };
  }

  const consumerResult = await options.consumer.submit(packet);
  return { status: "submitted", packet, consumerResult };
}
