/**
 * Wire-schema descriptor — the machinery behind `docs/ipc-protocol.md`'s
 * own conformance obligation (roadmap/05-supervisor-daemon.md work item 7:
 * "additive-only within a major version; add a conformance test that a
 * wire-format change lacking a version bump fails a schema-diff check").
 *
 * Introspects `WireMessageSchema`'s own live zod shape (every branch's
 * field names, sorted) into a small, deterministic, JSON-serializable
 * descriptor, keyed by `PROTOCOL_VERSION`. `wire-schema-golden.test.ts`
 * diffs this descriptor's current, live output against a byte-committed
 * golden file (`../../schemas/wire-protocol.v1.json`) — any accidental
 * field add/remove/rename shows up as a failing diff unless a human
 * deliberately re-generates the golden file, which this module's own
 * doc-comment convention pairs with a `PROTOCOL_VERSION` bump for any
 * BREAKING change (additive-only changes within the same major version are
 * still expected to update the golden file, just without bumping the
 * version — see `docs/ipc-protocol.md`'s own versioning section).
 */
import { z } from "zod";
import {
  EventEnvelopeSchema,
  HandshakeAckSchema,
  HandshakeRequestSchema,
  PROTOCOL_VERSION,
  RequestEnvelopeSchema,
  ResponseEnvelopeSchema,
} from "./wire-schema.js";

function sortedShapeKeys(schema: z.ZodObject<z.ZodRawShape>): readonly string[] {
  return Object.keys(schema.shape).sort();
}

export interface WireSchemaDescriptor {
  readonly protocolVersion: number;
  readonly messages: Readonly<Record<string, readonly string[]>>;
}

/** Computes the descriptor from the LIVE `./wire-schema.js` exports — never hand-duplicated field lists that could drift from the real schemas. */
export function computeWireSchemaDescriptor(): WireSchemaDescriptor {
  return {
    protocolVersion: PROTOCOL_VERSION,
    messages: {
      handshake: sortedShapeKeys(HandshakeRequestSchema),
      handshake_ack: sortedShapeKeys(HandshakeAckSchema),
      request: sortedShapeKeys(RequestEnvelopeSchema),
      response: sortedShapeKeys(ResponseEnvelopeSchema),
      event: sortedShapeKeys(EventEnvelopeSchema),
    },
  };
}
