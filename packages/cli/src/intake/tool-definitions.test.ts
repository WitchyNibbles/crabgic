import { describe, expect, it } from "vitest";
import { createToolRegistry } from "../gateway-mcp/registry.js";
import {
  CONTRACT_APPROVE_TOOL,
  PROJECT_INSPECT_TOOL,
  registerIntakeTools,
} from "./tool-definitions.js";

describe("registerIntakeTools", () => {
  it("registers project.inspect and contract.approve into the registry", () => {
    const registry = createToolRegistry();
    registerIntakeTools(registry);
    expect(registry.list().map((t) => t.name)).toEqual(["project.inspect", "contract.approve"]);
    expect(registry.get("project.inspect")).toBe(PROJECT_INSPECT_TOOL);
    expect(registry.get("contract.approve")).toBe(CONTRACT_APPROVE_TOOL);
  });

  it("contract.approve requires changeSetId/digest/token — never model-satisfiable with a bare call", () => {
    expect(CONTRACT_APPROVE_TOOL.inputSchema.required).toEqual(["changeSetId", "digest", "token"]);
  });

  it("throws DuplicateToolError on a second registration against the same registry", () => {
    const registry = createToolRegistry();
    registerIntakeTools(registry);
    expect(() => registerIntakeTools(registry)).toThrow(/already registered/);
  });
});
