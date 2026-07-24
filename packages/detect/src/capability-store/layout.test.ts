import { describe, expect, it } from "vitest";
import type { XdgEnv } from "@eo/journal";
import { resolveCapabilityEntryDir, resolveCapabilityStoreDir } from "./layout.js";

const ENV: XdgEnv = { HOME: "/home/eimi", XDG_CACHE_HOME: "/home/eimi/.cache" };

describe("capability-store layout", () => {
  it("nests capability-store/ directly under the pinned cache root (Gap 14 path order)", () => {
    expect(resolveCapabilityStoreDir(ENV, "abc123")).toBe(
      "/home/eimi/.cache/engineering-orchestrator/abc123/capability-store",
    );
  });

  it("nests one directory per store key under capability-store/", () => {
    expect(resolveCapabilityEntryDir(ENV, "abc123", "deadbeef")).toBe(
      "/home/eimi/.cache/engineering-orchestrator/abc123/capability-store/deadbeef",
    );
  });

  it("falls back to ~/.cache when XDG_CACHE_HOME is unset", () => {
    expect(resolveCapabilityStoreDir({ HOME: "/home/eimi" }, "abc123")).toBe(
      "/home/eimi/.cache/engineering-orchestrator/abc123/capability-store",
    );
  });
});
