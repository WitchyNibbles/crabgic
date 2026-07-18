import { describe, expect, it } from "vitest";
import {
  decodeMessageLine,
  encodeMessageToLine,
  tryDecodeMessageLine,
} from "./ndjson-message-codec.js";
import type { WireMessage } from "./wire-schema.js";

describe("ndjson-message-codec", () => {
  it("encodes a message to a single newline-terminated ndjson line", () => {
    const msg: WireMessage = { type: "handshake", protocolVersion: 1, clientName: "cli" };
    const line = encodeMessageToLine(msg);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.split("\n")).toHaveLength(2); // one JSON line + trailing empty
  });

  it("round-trips encode -> decode", () => {
    const msg: WireMessage = {
      type: "request",
      id: "r-1",
      op: "run.status",
      params: { runId: "abc" },
    };
    const line = encodeMessageToLine(msg).trimEnd();
    expect(decodeMessageLine(line)).toEqual(msg);
  });

  it("decodeLine throws on malformed JSON", () => {
    expect(() => decodeMessageLine("{not json")).toThrow();
  });

  it("decodeLine throws on a schema-invalid but valid-JSON line", () => {
    expect(() => decodeMessageLine(JSON.stringify({ type: "bogus" }))).toThrow();
  });

  it("tryDecodeMessageLine never throws, reports failure via the result", () => {
    const result = tryDecodeMessageLine("{not json");
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.message).toBeUndefined();
  });

  it("tryDecodeMessageLine reports success for a valid line", () => {
    const msg: WireMessage = { type: "event", event: "worker.log", payload: {} };
    const line = encodeMessageToLine(msg).trimEnd();
    const result = tryDecodeMessageLine(line);
    expect(result.ok).toBe(true);
    expect(result.message).toEqual(msg);
  });
});
