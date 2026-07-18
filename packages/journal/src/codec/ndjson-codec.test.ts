import { describe, expect, it } from "vitest";
import { computeEntryHash, GENESIS_PREV_HASH } from "./hash-chain.js";
import { CURRENT_SCHEMA_VERSION, FIRST_SEQ, JournalEntrySchema } from "./journal-entry.js";
import { decodeLine, encodeEntryToLine, tryDecodeLine } from "./ndjson-codec.js";

function sampleEntry() {
  const draft = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    seq: FIRST_SEQ,
    type: "fanout_rationale" as const,
    payload: { rationale: "balanced" },
    prevHash: GENESIS_PREV_HASH,
    timestamp: "2026-01-01T00:00:00.000Z",
  };
  return JournalEntrySchema.parse({ ...draft, hash: computeEntryHash(draft) });
}

describe("ndjson-codec", () => {
  it("encodeEntryToLine emits exactly one JSON object terminated by a single newline", () => {
    const entry = sampleEntry();
    const line = encodeEntryToLine(entry);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1).includes("\n")).toBe(false);
    expect(JSON.parse(line.slice(0, -1))).toEqual(entry);
  });

  it("decodeLine parses and validates a well-formed line", () => {
    const entry = sampleEntry();
    const line = encodeEntryToLine(entry).slice(0, -1);
    expect(decodeLine(line)).toEqual(entry);
  });

  it("decodeLine throws on malformed JSON", () => {
    expect(() => decodeLine("{not valid json")).toThrow();
  });

  it("decodeLine throws on well-formed JSON that fails schema validation", () => {
    expect(() => decodeLine(JSON.stringify({ not: "a journal entry" }))).toThrow();
  });

  it("tryDecodeLine never throws — reports ok:false with an error message on failure", () => {
    const result = tryDecodeLine("{not valid json");
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("tryDecodeLine reports ok:true with the decoded entry on success", () => {
    const entry = sampleEntry();
    const line = encodeEntryToLine(entry).slice(0, -1);
    const result = tryDecodeLine(line);
    expect(result.ok).toBe(true);
    expect(result.entry).toEqual(entry);
  });
});
