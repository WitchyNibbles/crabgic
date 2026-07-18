import { describe, expect, it } from "vitest";
import { evaluatePermissionLayer } from "../permission-evaluator.js";
import { evaluateSandboxLayer } from "../sandbox-evaluator.js";
import { alwaysAllowAdjudicate, evaluateAdjudicationLayer } from "../adjudication-layer.js";
import { CONFORMANCE_FIXTURES, resolveConformanceFixture } from "./fixtures.js";

/**
 * roadmap/03-envelope-compiler-engine-adapter.md exit criterion 4:
 * "Fake-engine replay parity: every fixture in the initial envelope-
 * conformance set produces its hand-derived expected per-layer verdict."
 * Each layer's OWN function runs in isolation here — the literal mechanism
 * behind "each layer independently assertable by disabling the others"
 * (work item 6).
 */
describe("envelope-conformance fixture set — exit criterion 4", () => {
  it.each(CONFORMANCE_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "%s reproduces its hand-derived expected per-layer verdict",
    async (_name, fixture) => {
      const { profile, permissionRules } = resolveConformanceFixture(fixture);
      const permissions = evaluatePermissionLayer(permissionRules, fixture.toolCall);
      const sandbox = evaluateSandboxLayer(profile.sandbox, fixture.toolCall);
      const adjudication = await evaluateAdjudicationLayer(alwaysAllowAdjudicate, fixture.toolCall);
      expect({ permissions, adjudication, sandbox }).toEqual(fixture.expected);
    },
  );

  it("covers exactly the seven required scenario classes (roadmap/03 work item 6)", () => {
    expect(CONFORMANCE_FIXTURES.map((fixture) => fixture.name).sort()).toEqual(
      [
        "compound-command-smuggling",
        "process-wrapper-smuggling",
        "path-escape-relative",
        "path-escape-absolute",
        "deny-wins-same-level",
        "deny-wins-cross-level",
        "blanket-mcp-deny-footgun",
      ].sort(),
    );
  });

  it("each fixture cites a baseline/spec source for its hand-derived expectation", () => {
    for (const fixture of CONFORMANCE_FIXTURES) {
      expect(fixture.baselineCitation.length).toBeGreaterThan(0);
      expect(fixture.description.length).toBeGreaterThan(0);
    }
  });

  it("each layer is independently callable without the others (disabling layers 3/4 to check layer 2 alone)", () => {
    const fixture = CONFORMANCE_FIXTURES.find((f) => f.name === "path-escape-relative");
    expect(fixture).toBeDefined();
    const { permissionRules } = resolveConformanceFixture(fixture!);
    // layer 2 alone, no sandbox/adjudication involved at all:
    expect(evaluatePermissionLayer(permissionRules, fixture!.toolCall)).toBe("deny");
  });
});
