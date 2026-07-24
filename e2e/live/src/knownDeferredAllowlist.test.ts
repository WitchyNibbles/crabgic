import { describe, expect, it } from "vitest";
import {
  KNOWN_DEFERRED_ALLOWLIST,
  KNOWN_DEFERRED_CLI_COMMANDS,
  KNOWN_DEFERRED_GATEWAY_FAMILIES,
  KNOWN_DEFERRED_GATEWAY_PROTOCOL,
} from "./knownDeferredAllowlist.js";

describe("KNOWN_DEFERRED_ALLOWLIST — schema sanity", () => {
  it("has exactly 15 CLI-command entries (14 real gaps + 1 dead-branch), 8 gateway-family entries, and 1 gateway-protocol entry (24 total)", () => {
    expect(KNOWN_DEFERRED_CLI_COMMANDS).toHaveLength(15);
    expect(KNOWN_DEFERRED_GATEWAY_FAMILIES).toHaveLength(8);
    expect(KNOWN_DEFERRED_GATEWAY_PROTOCOL).toHaveLength(1);
    expect(KNOWN_DEFERRED_ALLOWLIST).toHaveLength(24);
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
