import { describe, expect, it } from "vitest";
import { loadMarketplace, MarketplaceSchema } from "./marketplace-schema.js";
import { resolvePluginRoot } from "./plugin-root.js";
import { computeContentDigest } from "./content-digest.js";

const validEntry = {
  name: "engineering-orchestrator",
  source: "./..",
  description: "d",
  version: "0.0.0",
  license: "Apache-2.0",
  commit: "a".repeat(40),
  digest: "somedigest",
};

function validMarketplace() {
  return {
    $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
    name: "m",
    description: "d",
    owner: { name: "o", email: "o@example.invalid" },
    plugins: [validEntry],
  };
}

describe("MarketplaceSchema — valid fixture", () => {
  it("accepts a well-formed, SHA-pinned marketplace listing", () => {
    expect(MarketplaceSchema.safeParse(validMarketplace()).success).toBe(true);
  });
});

describe("MarketplaceSchema — work item 8's first failing test: unpinned (branch-ref) entry must fail", () => {
  it("rejects a plugin entry pinned to a branch ref instead of a full commit SHA", () => {
    const invalid = { ...validMarketplace(), plugins: [{ ...validEntry, commit: "main" }] };
    expect(MarketplaceSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a plugin entry pinned to a short/abbreviated SHA", () => {
    const invalid = { ...validMarketplace(), plugins: [{ ...validEntry, commit: "abc1234" }] };
    expect(MarketplaceSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a missing digest field", () => {
    const { digest: _digest, ...entryWithoutDigest } = validEntry;
    const invalid = { ...validMarketplace(), plugins: [entryWithoutDigest] };
    expect(MarketplaceSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("MarketplaceSchema — unknown-key rejection (.strict())", () => {
  it("rejects an unknown top-level key", () => {
    expect(MarketplaceSchema.safeParse({ ...validMarketplace(), extra: true }).success).toBe(false);
  });

  it("rejects an unknown plugin-entry key", () => {
    const invalid = { ...validMarketplace(), plugins: [{ ...validEntry, extra: true }] };
    expect(MarketplaceSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("loadMarketplace — this package's own real marketplace.json", () => {
  it("is schema-valid and SHA-pinned", () => {
    const marketplace = loadMarketplace(resolvePluginRoot());
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0]!.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("its recorded digest matches a fresh recomputation from this package's own on-disk files (freshness)", () => {
    const marketplace = loadMarketplace(resolvePluginRoot());
    const fresh = computeContentDigest(resolvePluginRoot());
    expect(marketplace.plugins[0]!.digest).toBe(fresh);
  });
});
