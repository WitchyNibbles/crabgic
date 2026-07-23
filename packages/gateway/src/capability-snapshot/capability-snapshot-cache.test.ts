import { describe, expect, it, vi } from "vitest";
import { ConnectorError } from "@eo/contracts";
import {
  CapabilitySnapshotCache,
  isInvalidatingError,
  DEFAULT_CAPABILITY_CACHE_TTL_SECONDS,
} from "./capability-snapshot-cache.js";

const CONNECTION_ID = "11111111-1111-4111-8111-111111111111";

function discoveredFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1 as const,
    id: "22222222-2222-4222-8222-222222222222",
    externalConnectionId: CONNECTION_ID,
    product: "jira",
    edition: "cloud",
    version: "unknown",
    apiFamilies: ["rest-v3"],
    resources: ["issue"],
    actions: ["read"],
    permissions: ["BROWSE_PROJECTS"],
    isReadOnly: true,
    ...overrides,
  };
}

describe("CapabilitySnapshotCache", () => {
  it("discovers once and serves the cached value on the next get within the TTL", async () => {
    const discover = vi.fn().mockResolvedValue(discoveredFixture());
    const cache = new CapabilitySnapshotCache(discover);

    const first = await cache.get(CONNECTION_ID);
    const second = await cache.get(CONNECTION_ID);

    expect(discover).toHaveBeenCalledOnce();
    expect(second).toEqual(first);
  });

  it("defaults the TTL to 15 minutes", () => {
    expect(DEFAULT_CAPABILITY_CACHE_TTL_SECONDS).toBe(900);
  });

  it("re-discovers once the cached entry's TTL has expired", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const discover = vi.fn().mockResolvedValue(discoveredFixture());
    const cache = new CapabilitySnapshotCache(discover, { ttlSeconds: 900, clock: () => now });

    await cache.get(CONNECTION_ID);
    now = new Date(now.getTime() + 901_000); // just past the 15-min TTL
    await cache.get(CONNECTION_ID);

    expect(discover).toHaveBeenCalledTimes(2);
  });

  it("invalidate forces the next get to re-discover", async () => {
    const discover = vi.fn().mockResolvedValue(discoveredFixture());
    const cache = new CapabilitySnapshotCache(discover);

    await cache.get(CONNECTION_ID);
    cache.invalidate(CONNECTION_ID);
    await cache.get(CONNECTION_ID);

    expect(discover).toHaveBeenCalledTimes(2);
  });

  it("computes discoveredAt/expiresAt as ISO instants ttlSeconds apart", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const discover = vi.fn().mockResolvedValue(discoveredFixture());
    const cache = new CapabilitySnapshotCache(discover, { ttlSeconds: 900, clock: () => now });

    const snapshot = await cache.get(CONNECTION_ID);
    expect(snapshot.discoveredAt).toBe("2026-01-01T00:00:00.000Z");
    expect(snapshot.expiresAt).toBe("2026-01-01T00:15:00.000Z");
  });
});

describe("isInvalidatingError / invalidateOnError", () => {
  it.each(["authentication", "permission", "unsupported"] as const)(
    "flags %s as invalidating",
    (kind) => {
      const err = ConnectorError[
        kind === "authentication" ? "authentication" : kind === "permission" ? "permission" : "unsupported"
      ]({ message: "x", provider: "jira", retryable: false });
      expect(isInvalidatingError(err)).toBe(true);
    },
  );

  it("does not flag a transient error as invalidating", () => {
    const err = ConnectorError.transient({ message: "x", provider: "jira", retryable: true });
    expect(isInvalidatingError(err)).toBe(false);
  });

  it("invalidateOnError invalidates the cache for an auth error", async () => {
    const discover = vi.fn().mockResolvedValue(discoveredFixture());
    const cache = new CapabilitySnapshotCache(discover);
    await cache.get(CONNECTION_ID);

    cache.invalidateOnError(
      CONNECTION_ID,
      ConnectorError.authentication({ message: "expired", provider: "jira", retryable: false }),
    );
    await cache.get(CONNECTION_ID);

    expect(discover).toHaveBeenCalledTimes(2);
  });

  it("invalidateOnError does not invalidate the cache for a transient error", async () => {
    const discover = vi.fn().mockResolvedValue(discoveredFixture());
    const cache = new CapabilitySnapshotCache(discover);
    await cache.get(CONNECTION_ID);

    cache.invalidateOnError(
      CONNECTION_ID,
      ConnectorError.transient({ message: "timeout", provider: "jira", retryable: true }),
    );
    await cache.get(CONNECTION_ID);

    expect(discover).toHaveBeenCalledTimes(1);
  });
});
