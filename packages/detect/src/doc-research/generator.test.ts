import { describe, expect, it } from "vitest";
import { generateDocResearchPacket, type DocResearchConsumer } from "./generator.js";

const INPUT = {
  topic: "OAuth token refresh semantics",
  objective: "determine whether refresh tokens rotate on every use",
  queries: ["OAuth2 refresh token rotation RFC"],
  sourcePaths: ["docs/auth.md"],
};

describe("generateDocResearchPacket", () => {
  it("degrades gracefully (typed fallback, no crash) when phase 11's drafting flow is unavailable (no consumer supplied)", async () => {
    const result = await generateDocResearchPacket(INPUT);
    expect(result.status).toBe("degraded");
    expect(result.packet.topic).toBe(INPUT.topic);
  });

  it("submits to the injected consumer and reports its result when phase 11's flow IS available", async () => {
    const consumer: DocResearchConsumer = {
      submit: (packet) => ({ accepted: true, topic: packet.topic }),
    };
    const result = await generateDocResearchPacket(INPUT, { consumer });
    expect(result.status).toBe("submitted");
    if (result.status === "submitted") {
      expect(result.consumerResult).toEqual({ accepted: true, topic: INPUT.topic });
    }
  });

  it("awaits an async consumer correctly", async () => {
    const consumer: DocResearchConsumer = {
      submit: async (packet) => Promise.resolve(`queued:${packet.topic}`),
    };
    const result = await generateDocResearchPacket(INPUT, { consumer });
    expect(result.status).toBe("submitted");
    if (result.status === "submitted") {
      expect(result.consumerResult).toBe(`queued:${INPUT.topic}`);
    }
  });

  it("never throws for a well-shaped input even with no consumer", async () => {
    await expect(generateDocResearchPacket(INPUT)).resolves.toBeDefined();
  });

  it("rejects a malformed input (empty queries array) via the packet schema's own validation", async () => {
    await expect(generateDocResearchPacket({ ...INPUT, queries: [] })).rejects.toThrow();
  });
});
