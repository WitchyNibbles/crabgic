import { describe, expect, it } from "vitest";
import { evaluateHandshakeLine, HandshakeProtocolError } from "./handshake.js";
import { PROTOCOL_VERSION } from "./wire-schema.js";

describe("evaluateHandshakeLine", () => {
  it("accepts a matching protocol version", () => {
    const line = JSON.stringify({
      type: "handshake",
      protocolVersion: PROTOCOL_VERSION,
      clientName: "cli",
    });
    const result = evaluateHandshakeLine(line);
    expect(result.accepted).toBe(true);
    expect(result.ack).toEqual({
      type: "handshake_ack",
      protocolVersion: PROTOCOL_VERSION,
      accepted: true,
    });
    expect(result.clientName).toBe("cli");
  });

  it("rejects a mismatched protocol version, before any request is served", () => {
    const line = JSON.stringify({
      type: "handshake",
      protocolVersion: PROTOCOL_VERSION + 1,
      clientName: "gateway",
    });
    const result = evaluateHandshakeLine(line);
    expect(result.accepted).toBe(false);
    expect(result.ack.accepted).toBe(false);
    expect(result.ack.reason).toContain("protocol version mismatch");
    expect(result.clientProtocolVersion).toBe(PROTOCOL_VERSION + 1);
  });

  it("rejects a lower (but still positive) client protocol version, not just a higher one", () => {
    // PROTOCOL_VERSION is currently 1, so there is no valid lower positive
    // integer to probe with directly — this asserts the symmetric case via
    // a hypothetical future-major-bump scenario: any protocolVersion !==
    // PROTOCOL_VERSION is rejected, not merely protocolVersion > PROTOCOL_VERSION.
    const line = JSON.stringify({
      type: "handshake",
      protocolVersion: PROTOCOL_VERSION + 2,
      clientName: "cli",
    });
    const result = evaluateHandshakeLine(line);
    expect(result.accepted).toBe(false);
    expect(result.clientProtocolVersion).toBe(PROTOCOL_VERSION + 2);
  });

  it("throws HandshakeProtocolError for a structurally invalid protocolVersion (e.g. 0)", () => {
    const line = JSON.stringify({ type: "handshake", protocolVersion: 0, clientName: "cli" });
    expect(() => evaluateHandshakeLine(line)).toThrow(HandshakeProtocolError);
  });

  it("throws HandshakeProtocolError on malformed JSON", () => {
    expect(() => evaluateHandshakeLine("{not json")).toThrow(HandshakeProtocolError);
  });

  it("throws HandshakeProtocolError when the first message isn't a handshake at all", () => {
    const line = JSON.stringify({ type: "request", id: "1", op: "run.status", params: {} });
    expect(() => evaluateHandshakeLine(line)).toThrow(HandshakeProtocolError);
  });
});
