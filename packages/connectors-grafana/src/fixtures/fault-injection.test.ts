import { describe, expect, it } from "vitest";
import { FAULT_INJECTION_MATRIX, neverCalledSend } from "./fault-injection-matrix.js";

describe("FAULT_INJECTION_MATRIX — every scenario self-verifies as passing", () => {
  it("covers all 3 named categories", () => {
    const categories = new Set(FAULT_INJECTION_MATRIX.map((s) => s.category));
    expect([...categories].sort()).toEqual(["forged-delete-admin", "redaction", "tenant-boundary"]);
  });

  it.each(FAULT_INJECTION_MATRIX.map((s) => [s.name, s] as const))(
    "%s",
    async (_name, scenario) => {
      const result = await scenario.run();
      expect(result.passed, result.detail).toBe(true);
    },
  );
});

describe("neverCalledSend — the test-support helper itself, exercised directly", () => {
  it("records any call made to it and returns a 200 (used only to detect a regression, never expected to fire)", async () => {
    const { send, calls } = neverCalledSend();
    const response = await send({ method: "DELETE", path: "/api/folders/x" });
    expect(response.status).toBe(200);
    expect(calls).toEqual([{ method: "DELETE", path: "/api/folders/x" }]);
  });
});
