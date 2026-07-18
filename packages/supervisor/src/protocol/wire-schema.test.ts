import { describe, expect, it } from "vitest";
import {
  buildErrorResponse,
  buildOkResponse,
  EventEnvelopeSchema,
  HandshakeAckSchema,
  HandshakeRequestSchema,
  PROTOCOL_VERSION,
  RequestEnvelopeSchema,
  ResponseEnvelopeSchema,
  WireMessageSchema,
} from "./wire-schema.js";

describe("wire-schema", () => {
  it("round-trips a handshake request", () => {
    const msg = { type: "handshake", protocolVersion: PROTOCOL_VERSION, clientName: "cli" };
    expect(WireMessageSchema.parse(msg)).toEqual(msg);
    expect(HandshakeRequestSchema.parse(msg)).toEqual(msg);
  });

  it("round-trips a handshake ack, accepted and rejected", () => {
    const ok = { type: "handshake_ack", protocolVersion: 1, accepted: true };
    expect(HandshakeAckSchema.parse(ok)).toEqual(ok);
    const bad = { type: "handshake_ack", protocolVersion: 1, accepted: false, reason: "mismatch" };
    expect(HandshakeAckSchema.parse(bad)).toEqual(bad);
  });

  it("round-trips a request envelope", () => {
    const msg = { type: "request", id: "req-1", op: "run.status", params: { runId: "r1" } };
    expect(RequestEnvelopeSchema.parse(msg)).toEqual(msg);
  });

  it("round-trips response envelopes via the builder helpers", () => {
    const ok = buildOkResponse("req-1", { status: "running" });
    expect(ResponseEnvelopeSchema.parse(ok)).toEqual(ok);
    expect(ok.ok).toBe(true);

    const err = buildErrorResponse("req-1", "NOT_FOUND", "no such run");
    expect(ResponseEnvelopeSchema.parse(err)).toEqual(err);
    expect(err.ok).toBe(false);
  });

  it("round-trips a server-push event envelope", () => {
    const msg = { type: "event", event: "worker.log", payload: { line: "hello" } };
    expect(EventEnvelopeSchema.parse(msg)).toEqual(msg);
  });

  it("rejects an unknown message type", () => {
    expect(() => WireMessageSchema.parse({ type: "bogus" })).toThrow();
  });

  it("rejects extra keys on every branch (.strict())", () => {
    expect(() =>
      RequestEnvelopeSchema.parse({
        type: "request",
        id: "x",
        op: "run.status",
        params: {},
        extra: true,
      }),
    ).toThrow();
  });
});
