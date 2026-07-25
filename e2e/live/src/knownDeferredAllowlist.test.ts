import { describe, expect, it } from "vitest";
import {
  KNOWN_DEFERRED_ALLOWLIST,
  KNOWN_DEFERRED_CLI_COMMANDS,
  KNOWN_DEFERRED_GATEWAY_FAMILIES,
  KNOWN_DEFERRED_GATEWAY_PROTOCOL,
  KNOWN_DEFERRED_GATEWAY_PROVIDERS,
  ALL_TRACKED_DEFERRALS,
} from "./knownDeferredAllowlist.js";

describe("KNOWN_DEFERRED_ALLOWLIST — schema sanity", () => {
  /**
   * Was 24 (15 CLI + 8 gateway-family + 1 gateway-protocol) until the
   * phase-23 composition-root work wired 18 of them. Every gateway family
   * and the tools/call protocol gap are now genuinely closed, so those two
   * buckets are empty rather than merely shorter.
   */
  it("has exactly 5 CLI-command entries and no remaining gateway-family or gateway-protocol entries", () => {
    expect(KNOWN_DEFERRED_CLI_COMMANDS).toHaveLength(5);
    expect(KNOWN_DEFERRED_GATEWAY_FAMILIES).toHaveLength(0);
    expect(KNOWN_DEFERRED_GATEWAY_PROTOCOL).toHaveLength(0);
    expect(KNOWN_DEFERRED_ALLOWLIST).toHaveLength(5);
  });

  /** The provider-dispatch deferral is tracked but deliberately outside the sweep's exact-match set — it has no stub for the sweep to discover. */
  it("tracks the provider-dispatch deferral separately from the sweep-matched allowlist", () => {
    expect(KNOWN_DEFERRED_GATEWAY_PROVIDERS).toHaveLength(1);
    expect(KNOWN_DEFERRED_ALLOWLIST.map((e) => e.id)).not.toContain("gateway.provider.dispatch");
    expect(ALL_TRACKED_DEFERRALS.map((e) => e.id)).toContain("gateway.provider.dispatch");
  });

  it("every entry has a unique, non-empty id", () => {
    const ids = KNOWN_DEFERRED_ALLOWLIST.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it("every entry has a non-empty ownerPhase, description, and at least one location", () => {
    for (const entry of KNOWN_DEFERRED_ALLOWLIST) {
      expect(entry.ownerPhase.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.location.length).toBeGreaterThan(0);
      for (const loc of entry.location) {
        expect(loc.length).toBeGreaterThan(0);
      }
    }
  });

  it("every entry's kind matches its own bucket", () => {
    expect(KNOWN_DEFERRED_CLI_COMMANDS.every((e) => e.kind === "cli-command")).toBe(true);
    expect(KNOWN_DEFERRED_GATEWAY_FAMILIES.every((e) => e.kind === "gateway-family")).toBe(true);
    expect(KNOWN_DEFERRED_GATEWAY_PROTOCOL.every((e) => e.kind === "gateway-protocol")).toBe(true);
  });
});
