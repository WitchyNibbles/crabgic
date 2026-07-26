import { describe, expect, it } from "vitest";
import {
  loadMarketplace,
  loadUnpinnedMarketplace,
  MarketplaceSchema,
  NULL_GIT_OBJECT_ID,
  readMarketplaceJson,
  UnpinnedMarketplaceSchema,
} from "./marketplace-schema.js";
import { resolvePluginRoot } from "./plugin-root.js";
import { computeContentDigest } from "./content-digest.js";

const validEntry = {
  name: "crabgic",
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

  it("rejects the all-zero NULL object ID — 40 hex zeros is a syntactically-valid SHA that can never resolve to a commit (an unpinned placeholder, not a pin)", () => {
    const invalid = {
      ...validMarketplace(),
      plugins: [{ ...validEntry, commit: NULL_GIT_OBJECT_ID }],
    };
    const parsed = MarketplaceSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message).join(" ")).toContain(
      "all-zero placeholder",
    );
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

describe("UnpinnedMarketplaceSchema / loadUnpinnedMarketplace — identity-only read", () => {
  it("accepts the all-zero placeholder (identity fields are readable before the release pin is cut)", () => {
    const placeholder = {
      ...validMarketplace(),
      plugins: [{ ...validEntry, commit: NULL_GIT_OBJECT_ID }],
    };
    expect(UnpinnedMarketplaceSchema.safeParse(placeholder).success).toBe(true);
  });

  it("still rejects a branch ref — leniency is scoped to the placeholder, never to an unpinnable ref", () => {
    const branchRef = { ...validMarketplace(), plugins: [{ ...validEntry, commit: "main" }] };
    expect(UnpinnedMarketplaceSchema.safeParse(branchRef).success).toBe(false);
  });
});

describe("loadMarketplace — this package's own real, committed marketplace.json", () => {
  // WAS: "is schema-valid and SHA-pinned", asserting only
  // /^[0-9a-f]{40}$/ — which the committed all-zero PLACEHOLDER satisfies.
  // That test asserted a falsehood: nothing about this repo's listing is
  // pinned to a release commit. The assertions below record the real state.
  it("is NOT SHA-pinned today — the committed entry carries the all-zero placeholder, which strict validation now REJECTS", () => {
    const raw = readMarketplaceJson(resolvePluginRoot()) as {
      readonly plugins: readonly { readonly commit: string }[];
    };
    expect(raw.plugins).toHaveLength(1);
    expect(raw.plugins[0]!.commit).toBe(NULL_GIT_OBJECT_ID);
    expect(() => loadMarketplace(resolvePluginRoot())).toThrow(/all-zero placeholder/);
    // When the owner actually cuts the v1.0.0 marketplace entry at the
    // release commit, this expectation flips to `loadMarketplace` returning
    // a real 40-hex SHA — deliberately a test edit the owner must make
    // knowingly, rather than a check that silently passes either way.
  });

  it("its recorded digest matches a fresh recomputation from this package's own on-disk files (freshness)", () => {
    const marketplace = loadUnpinnedMarketplace(resolvePluginRoot());
    const fresh = computeContentDigest(resolvePluginRoot());
    expect(marketplace.plugins[0]!.digest).toBe(fresh);
  });
});
