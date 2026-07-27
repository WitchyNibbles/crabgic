/**
 * Discovery metadata on the marketplace plugin entry.
 *
 * Every field asserted here is one the vendor's plugin-marketplace reference
 * lists as a supported optional entry field: `displayName`, `author`,
 * `homepage`, `repository`, `keywords`. `displayName` carries a documented
 * minimum engine version of 2.1.143, which the accepted range recorded in
 * `docs/engine-baseline.md` (2.1.207–2.1.220) clears at its lower bound.
 *
 * Deliberately NOT asserted: an `icon` field. The plugin system has no such
 * field — not on a marketplace entry, not in `plugin.json` — so the strict
 * schema must keep rejecting it rather than carrying a key the engine ignores.
 */
import { describe, expect, it } from "vitest";
import { loadUnpinnedMarketplace, MarketplaceSchema } from "./marketplace-schema.js";
import { resolvePluginRoot } from "./plugin-root.js";

const pinnedEntry = {
  name: "crabgic",
  source: "./",
  description: "d",
  version: "1.0.1",
  license: "Apache-2.0",
  commit: "a".repeat(40),
  digest: "somedigest",
};

function marketplaceWith(entryExtras: Record<string, unknown>) {
  return {
    $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
    name: "m",
    description: "d",
    owner: { name: "o", email: "o@example.invalid" },
    plugins: [{ ...pinnedEntry, ...entryExtras }],
  };
}

describe("MarketplacePluginEntrySchema — supported discovery metadata", () => {
  it("accepts displayName", () => {
    expect(MarketplaceSchema.safeParse(marketplaceWith({ displayName: "Crabgic" })).success).toBe(
      true,
    );
  });

  it("accepts an author object with name, email and url", () => {
    const author = { name: "n", email: "e@example.invalid", url: "https://example.invalid" };
    expect(MarketplaceSchema.safeParse(marketplaceWith({ author })).success).toBe(true);
  });

  it("accepts an author object carrying only the required name", () => {
    expect(MarketplaceSchema.safeParse(marketplaceWith({ author: { name: "n" } })).success).toBe(
      true,
    );
  });

  it("rejects an author object with no name", () => {
    expect(
      MarketplaceSchema.safeParse(marketplaceWith({ author: { email: "e@example.invalid" } }))
        .success,
    ).toBe(false);
  });

  it("accepts homepage, repository and keywords", () => {
    const extras = {
      homepage: "https://example.invalid",
      repository: "https://example.invalid/repo",
      keywords: ["a", "b"],
    };
    expect(MarketplaceSchema.safeParse(marketplaceWith(extras)).success).toBe(true);
  });

  it("still rejects an icon field — the plugin system has none, so a strict schema must not invent one", () => {
    expect(MarketplaceSchema.safeParse(marketplaceWith({ icon: "./icon.png" })).success).toBe(
      false,
    );
  });

  it("keeps every added field optional, so an entry without them still validates", () => {
    expect(MarketplaceSchema.safeParse(marketplaceWith({})).success).toBe(true);
  });
});

describe("this package's own committed marketplace.json carries the metadata", () => {
  const entry = () => loadUnpinnedMarketplace(resolvePluginRoot()).plugins[0]!;

  it("declares a human-readable displayName distinct from the kebab-case name", () => {
    expect(entry().displayName).toBe("Crabgic");
    expect(entry().name).toBe("crabgic");
  });

  it("declares an author and points at the real repository and homepage", () => {
    expect(entry().author?.name).toBe("Crabgic");
    expect(entry().repository).toBe("https://github.com/WitchyNibbles/crabgic");
    expect(entry().homepage).toBe("https://github.com/WitchyNibbles/crabgic#readme");
  });

  it("declares discovery keywords", () => {
    expect(entry().keywords).toEqual(
      expect.arrayContaining(["orchestration", "autonomous", "jira", "grafana"]),
    );
  });
});
