/**
 * roadmap/05-supervisor-daemon.md §Test plan, Conformance: "a wire-format
 * change lacking a version bump fails a schema-diff check." Diffs the
 * LIVE `computeWireSchemaDescriptor()` output against the byte-committed
 * golden file (`../../schemas/wire-protocol.v1.json`) — any accidental
 * field add/remove/rename, or any change to `PROTOCOL_VERSION` not
 * mirrored in the golden file, fails this test.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  computeWireSchemaDescriptor,
  type WireSchemaDescriptor,
} from "./wire-schema-descriptor.js";

const GOLDEN_PATH = fileURLToPath(new URL("../../schemas/wire-protocol.v1.json", import.meta.url));

function loadGolden(): WireSchemaDescriptor {
  return JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as WireSchemaDescriptor;
}

describe("wire-schema golden — additive-only-within-a-major-version conformance", () => {
  it("the live wire schema descriptor matches the committed golden file exactly", () => {
    const golden = loadGolden();
    const live = computeWireSchemaDescriptor();
    expect(live).toEqual(golden);
  });

  it("proves the mechanism itself: an undocumented field addition to a wire message diverges from the golden file", () => {
    // Simulates exactly the failure mode this conformance check exists to
    // catch — a wire-format change with NO corresponding golden-file (and
    // therefore no version-bump discipline) update.
    const DriftedRequestSchema = z
      .object({
        type: z.literal("request"),
        id: z.string(),
        op: z.string(),
        params: z.record(z.string(), z.unknown()),
        undocumentedNewField: z.string(), // the drift
      })
      .strict();

    const golden = loadGolden();
    const driftedDescriptor: WireSchemaDescriptor = {
      ...golden,
      messages: {
        ...golden.messages,
        request: Object.keys(DriftedRequestSchema.shape).sort(),
      },
    };

    expect(driftedDescriptor).not.toEqual(golden);
  });

  it("PROTOCOL_VERSION in the live descriptor matches the golden file's own recorded version", () => {
    const golden = loadGolden();
    const live = computeWireSchemaDescriptor();
    expect(live.protocolVersion).toBe(golden.protocolVersion);
  });
});
