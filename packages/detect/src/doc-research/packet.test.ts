import { describe, expect, it } from "vitest";
import { buildDocResearchPacket, DocResearchPacketSchema } from "./packet.js";

describe("buildDocResearchPacket", () => {
  it("builds a schema-valid packet with a createdAt timestamp from the injected clock", () => {
    const packet = buildDocResearchPacket(
      {
        topic: "x",
        objective: "y",
        queries: ["q1"],
        sourcePaths: [],
      },
      () => "2026-01-01T00:00:00.000Z",
    );
    expect(DocResearchPacketSchema.safeParse(packet).success).toBe(true);
    expect(packet.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects an input with zero queries", () => {
    expect(() =>
      buildDocResearchPacket({ topic: "x", objective: "y", queries: [], sourcePaths: [] }),
    ).toThrow();
  });

  it("rejects an input with an empty topic", () => {
    expect(() =>
      buildDocResearchPacket({ topic: "", objective: "y", queries: ["q"], sourcePaths: [] }),
    ).toThrow();
  });
});
