import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { compileEnvelope } from "../compiler/compile-envelope.js";
import { buildEnvelopeFixture } from "../compiler/envelope-fixture.js";
import { assertNoBlanketMcpDeny } from "./invariants.js";
import { envelopeArbitrary } from "./envelope-arbitrary.js";

/**
 * Footgun: never emit a blanket `mcp__*` deny (roadmap/03-envelope-
 * compiler-engine-adapter.md §In scope, "Footguns as tests": "never emit a
 * blanket `mcp__*` deny (deny beats the gateway allow, per Appendix B's
 * own warning)"; docs/claude-code-adaptation.md Appendix B). A deny beats
 * an allow at any level (adaptation §4.1: "deny -> ask -> allow, first
 * match wins"), so a blanket `mcp__*` deny would silently shadow the
 * mandatory `mcp__${GATEWAY_MCP_SERVER_NAME}__*` allow this compiler also
 * emits — the single most consequential mistake this compiler could make.
 */
describe("footgun: never a blanket mcp__* deny", () => {
  it("a minimal envelope's compiled deny list never contains 'mcp__*'", () => {
    expect(() => assertNoBlanketMcpDeny(compileEnvelope(buildEnvelopeFixture()))).not.toThrow();
  });

  it("the mandatory gateway allow entry is always present, never shadowed", () => {
    const profile = compileEnvelope(buildEnvelopeFixture());
    expect(profile.permissions.allow).toContain(`mcp__${GATEWAY_MCP_SERVER_NAME}__*`);
  });

  it("no envelope, of any shape, ever produces a blanket mcp__* deny (fast-check, ≥10k cases)", () => {
    fc.assert(
      fc.property(envelopeArbitrary(), (envelope) => {
        expect(() => assertNoBlanketMcpDeny(compileEnvelope(envelope))).not.toThrow();
      }),
      { numRuns: 10000 },
    );
    // 20s timeout: 10k fast-check cases can exceed vitest's default 5s under
    // full-suite parallel CPU contention (matches anchor-forms.test.ts).
  }, 20000);

  it("single-server exposure comes from strictMcpConfig, not a deny (roadmap/03's own footgun bullet)", () => {
    const compiled = compileEnvelope(buildEnvelopeFixture());
    expect(compiled.sdkOptions.strictMcpConfig).toBe(true);
    expect(Object.keys(compiled.sdkOptions.mcpServers)).toEqual([GATEWAY_MCP_SERVER_NAME]);
  });
});
