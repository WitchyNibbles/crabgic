import { describe, expect, it } from "vitest";
import {
  GrafanaMcpWrapConfigError,
  buildGrafanaMcpWrapCapabilityEntry,
} from "./upstream-mcp-policy.js";

describe("buildGrafanaMcpWrapCapabilityEntry — optional, flag-gated, never auto-approved (roadmap/20 §Risks)", () => {
  it("returns undefined when disabled — HTTP APIs remain the only default path", () => {
    expect(buildGrafanaMcpWrapCapabilityEntry({ enabled: false })).toBeUndefined();
  });

  it("returns a pending mcp_server entry when enabled with a digest", () => {
    const entry = buildGrafanaMcpWrapCapabilityEntry({ enabled: true, digest: "sha256:abc123" });
    expect(entry).toEqual({
      kind: "mcp_server",
      name: "grafana-mcp",
      digest: "sha256:abc123",
      decision: "pending",
    });
  });

  it("carries an optional sourceRef when supplied", () => {
    const entry = buildGrafanaMcpWrapCapabilityEntry({
      enabled: true,
      digest: "sha256:abc123",
      sourceRef: "grafana/mcp-grafana@deadbeef",
    });
    expect(entry?.kind === "mcp_server" && entry.sourceRef).toBe("grafana/mcp-grafana@deadbeef");
  });

  it("throws when enabled without a digest — never declares an unpinned capability", () => {
    expect(() => buildGrafanaMcpWrapCapabilityEntry({ enabled: true })).toThrow(
      GrafanaMcpWrapConfigError,
    );
    expect(() => buildGrafanaMcpWrapCapabilityEntry({ enabled: true, digest: "" })).toThrow(
      GrafanaMcpWrapConfigError,
    );
  });

  it('the decision is always "pending" — there is no parameter that can request "approved"', () => {
    const entry = buildGrafanaMcpWrapCapabilityEntry({ enabled: true, digest: "sha256:xyz" });
    expect(entry?.kind === "mcp_server" && entry.decision).toBe("pending");
    // Type-level proof: GrafanaMcpWrapOptions has no `decision` field at all.
    const options: import("./upstream-mcp-policy.js").GrafanaMcpWrapOptions = {
      enabled: true,
      digest: "sha256:xyz",
    };
    expect(Object.keys(options)).not.toContain("decision");
  });
});
