/**
 * UDS control-plane wire protocol — roadmap/05-supervisor-daemon.md work
 * item 1: "protocol codec + versioned handshake"; §In scope, "UDS control
 * plane": "ndjson request/response plus server-push events... versioned
 * handshake rejects a mismatched protocol version before serving a
 * request." One line of ndjson per message; every message validates
 * against exactly one branch of `WireMessageSchema` below — mirrors this
 * repo's existing discriminated-union style (`@eo/journal`'s
 * `JournalEntrySchema`): hand-written `.strict()` branches, discriminated
 * on `type`, not a `.map()`-generated union.
 *
 * `PROTOCOL_VERSION` is this wire protocol's own major version — additive
 * changes within a major version never bump it (roadmap/05 §Interfaces
 * produced, `docs/ipc-protocol.md`: "additive-only within a major
 * version"); see `../../../docs/ipc-protocol.md` for the human-readable
 * reference this schema is written against.
 */

import { z } from "zod";
import { NonEmptyStringSchema } from "@eo/contracts";

export const PROTOCOL_VERSION = 1;

/** First message a client sends on every new connection, before any request/response traffic. */
export const HandshakeRequestSchema = z
  .object({
    type: z.literal("handshake"),
    protocolVersion: z.number().int().positive(),
    clientName: NonEmptyStringSchema,
  })
  .strict();
export type HandshakeRequest = z.infer<typeof HandshakeRequestSchema>;

/** The server's reply to a handshake — `accepted: false` on a protocol-version mismatch; the server closes the connection immediately after sending this when `accepted` is `false`, serving nothing further. */
export const HandshakeAckSchema = z
  .object({
    type: z.literal("handshake_ack"),
    protocolVersion: z.number().int().positive(),
    accepted: z.boolean(),
    reason: NonEmptyStringSchema.optional(),
  })
  .strict();
export type HandshakeAck = z.infer<typeof HandshakeAckSchema>;

/** A client-issued request against one router operation family (`run.status`, `worker.*`, ...). */
export const RequestEnvelopeSchema = z
  .object({
    type: z.literal("request"),
    id: NonEmptyStringSchema,
    op: NonEmptyStringSchema,
    params: z.record(z.string(), z.unknown()),
  })
  .strict();
export type RequestEnvelope = z.infer<typeof RequestEnvelopeSchema>;

/** The server's reply to exactly one `RequestEnvelope`, correlated by `id`. */
export const ResponseEnvelopeSchema = z
  .object({
    type: z.literal("response"),
    id: NonEmptyStringSchema,
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: NonEmptyStringSchema,
        message: NonEmptyStringSchema,
      })
      .strict()
      .optional(),
  })
  .strict();
export type ResponseEnvelope = z.infer<typeof ResponseEnvelopeSchema>;

/** An unsolicited server-push message (e.g. a ring-buffer log line, a worker lifecycle notification) — never correlated to a request `id`. */
export const EventEnvelopeSchema = z
  .object({
    type: z.literal("event"),
    event: NonEmptyStringSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/** Every message this protocol ever frames on the wire — one ndjson line per message. */
export const WireMessageSchema = z.discriminatedUnion("type", [
  HandshakeRequestSchema,
  HandshakeAckSchema,
  RequestEnvelopeSchema,
  ResponseEnvelopeSchema,
  EventEnvelopeSchema,
]);
export type WireMessage = z.infer<typeof WireMessageSchema>;

/** Builds a `ok: true` response envelope for `request`. */
export function buildOkResponse(requestId: string, result: unknown): ResponseEnvelope {
  return { type: "response", id: requestId, ok: true, result };
}

/** Builds an `ok: false` response envelope for `request`, carrying a `code`/`message` error pair. */
export function buildErrorResponse(
  requestId: string,
  code: string,
  message: string,
): ResponseEnvelope {
  return { type: "response", id: requestId, ok: false, error: { code, message } };
}
