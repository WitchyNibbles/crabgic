import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  // HISTORY, because this expectation has now flipped twice and each flip
  // was meant to be deliberate. It first asserted "is schema-valid and
  // SHA-pinned" against only /^[0-9a-f]{40}$/ — which the all-zero
  // PLACEHOLDER satisfies, so it asserted a falsehood. It was then rewritten
  // to record the honest placeholder state, with a note that cutting the
  // real entry would require flipping it back "knowingly, rather than a check
  // that silently passes either way". This is that flip: the entry is pinned
  // at a real release commit, and the version is read from the CLI manifest
  // so the case does not need re-editing at each cut.
  it("is SHA-pinned to a real release commit, not the all-zero placeholder", () => {
    const raw = readMarketplaceJson(resolvePluginRoot()) as {
      readonly plugins: readonly { readonly commit: string; readonly version: string }[];
    };
    expect(raw.plugins).toHaveLength(1);
    expect(raw.plugins[0]!.commit).not.toBe(NULL_GIT_OBJECT_ID);
    expect(raw.plugins[0]!.commit).toMatch(/^[0-9a-f]{40}$/);
    // Read from the CLI manifest rather than hardcoded: the listing's version
    // tracks the published package, so pinning a literal here would need an
    // edit at every release and would fail the cut rather than guard it.
    const cliVersion = JSON.parse(
      readFileSync(resolve(resolvePluginRoot(), "..", "cli", "package.json"), "utf-8"),
    ).version as string;
    expect(raw.plugins[0]!.version).toBe(cliVersion);

    // Strict validation, which rejects the placeholder, now accepts it.
    const marketplace = loadMarketplace(resolvePluginRoot());
    expect(marketplace.plugins[0]!.commit).toBe(raw.plugins[0]!.commit);
  });

  // The 40-hex shape is necessary but not sufficient — it says nothing about
  // whether that commit EXISTS, or whether it is the one being released.
  // `e2e/release`'s `marketplacePinCheck` resolves it against the repository
  // and compares it to the release-candidate object ID; this only guards the
  // shape, and says so rather than implying more.
  it("still REJECTS the all-zero placeholder, so the pin cannot regress to it", () => {
    const placeholder = {
      ...validMarketplace(),
      plugins: [{ ...validEntry, commit: NULL_GIT_OBJECT_ID }],
    };
    expect(MarketplaceSchema.safeParse(placeholder).success).toBe(false);
  });

  it("its recorded digest matches a fresh recomputation from this package's own on-disk files (freshness)", () => {
    const marketplace = loadUnpinnedMarketplace(resolvePluginRoot());
    const fresh = computeContentDigest(resolvePluginRoot());
    expect(marketplace.plugins[0]!.digest).toBe(fresh);
  });
});
