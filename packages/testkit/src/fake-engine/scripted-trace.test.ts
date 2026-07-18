import { describe, expect, it } from "vitest";
import { WorkerResultSchema } from "@eo/contracts";
import { buildFakeEngineScript } from "./scripted-trace.js";

describe("buildFakeEngineScript", () => {
  it("produces a deterministic default sessionId across calls with no overrides", () => {
    expect(buildFakeEngineScript().sessionId).toBe(buildFakeEngineScript().sessionId);
  });

  it("the default structuredOutput conforms to WorkerResultSchema (deliverable 1: 'normal-path result conforms to WorkerResult')", () => {
    const script = buildFakeEngineScript();
    expect(() => WorkerResultSchema.parse(script.structuredOutput)).not.toThrow();
  });

  it("honors overrides immutably (two successive builds with different overrides don't leak into each other)", () => {
    const a = buildFakeEngineScript({
      sessionId: "session-a",
      toolCalls: [{ toolName: "Bash", toolInput: {} }],
    });
    const b = buildFakeEngineScript({ sessionId: "session-b" });
    expect(a.sessionId).toBe("session-a");
    expect(b.sessionId).toBe("session-b");
    expect(b.toolCalls).toEqual([]);
  });

  it("defaults toolCalls/mcpServers to empty arrays", () => {
    const script = buildFakeEngineScript();
    expect(script.toolCalls).toEqual([]);
    expect(script.mcpServers).toEqual([]);
  });

  it("an onResume continuation script can be attached", () => {
    const resumeScript = buildFakeEngineScript({ sessionId: "resumed" });
    const script = buildFakeEngineScript({ onResume: resumeScript });
    expect(script.onResume?.sessionId).toBe("resumed");
  });
});
