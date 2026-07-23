/**
 * `CapabilitySnapshot` cache — roadmap/16-gateway-core.md §In scope:
 * "15-min cache; invalidation on auth/permission/unsupported errors;
 * unknown versions read-only." Work item 3.
 *
 * Keyed by `externalConnectionId`. `get` re-discovers (via the caller-
 * supplied `discover` function) whenever there is no cached entry or the
 * cached entry's `expiresAt` has passed — the TTL default is 15 minutes,
 * matching `ExternalConnection.discoveryTtlSeconds`'s own default-echo
 * documented in that schema. `invalidate` is called explicitly by a
 * caller that just observed an auth/permission/unsupported
 * `ConnectorError` for a connection, forcing the next `get` to
 * re-discover rather than serve a stale, possibly-now-wrong snapshot.
 */

import type { CapabilitySnapshot } from "@eo/contracts";
import type { ConnectorError } from "@eo/contracts";

export const DEFAULT_CAPABILITY_CACHE_TTL_SECONDS = 15 * 60;

export type DiscoverCapabilitySnapshot = (
  connectionId: string,
) => Promise<Omit<CapabilitySnapshot, "discoveredAt" | "expiresAt">>;

export interface CapabilitySnapshotCacheOptions {
  readonly ttlSeconds?: number;
  readonly clock?: () => Date;
}

/** Errors that force cache invalidation for the connection they were raised against — roadmap/16: "invalidation on auth/permission/unsupported errors." */
const INVALIDATING_ERROR_KINDS = new Set<ConnectorError["kind"]>([
  "authentication",
  "permission",
  "unsupported",
]);

export function isInvalidatingError(error: ConnectorError): boolean {
  return INVALIDATING_ERROR_KINDS.has(error.kind);
}

export class CapabilitySnapshotCache {
  readonly #entries = new Map<string, CapabilitySnapshot>();
  readonly #discover: DiscoverCapabilitySnapshot;
  readonly #ttlSeconds: number;
  readonly #clock: () => Date;

  constructor(discover: DiscoverCapabilitySnapshot, options: CapabilitySnapshotCacheOptions = {}) {
    this.#discover = discover;
    this.#ttlSeconds = options.ttlSeconds ?? DEFAULT_CAPABILITY_CACHE_TTL_SECONDS;
    this.#clock = options.clock ?? (() => new Date());
  }

  /** Returns the cached snapshot if fresh, otherwise re-discovers, caches, and returns the new one. */
  async get(connectionId: string): Promise<CapabilitySnapshot> {
    const cached = this.#entries.get(connectionId);
    const now = this.#clock();
    if (cached !== undefined && new Date(cached.expiresAt).getTime() > now.getTime()) {
      return cached;
    }
    return this.#refresh(connectionId, now);
  }

  /** Forces the next `get` for `connectionId` to re-discover, per the auth/permission/unsupported invalidation rule. */
  invalidate(connectionId: string): void {
    this.#entries.delete(connectionId);
  }

  /** Convenience: invalidates iff `error` is one of the invalidating kinds — the one call site callers need after a failed provider call. */
  invalidateOnError(connectionId: string, error: ConnectorError): void {
    if (isInvalidatingError(error)) {
      this.invalidate(connectionId);
    }
  }

  async #refresh(connectionId: string, now: Date): Promise<CapabilitySnapshot> {
    const discovered = await this.#discover(connectionId);
    const expiresAt = new Date(now.getTime() + this.#ttlSeconds * 1000).toISOString();
    const snapshot: CapabilitySnapshot = {
      ...discovered,
      discoveredAt: now.toISOString(),
      expiresAt,
    };
    this.#entries.set(connectionId, snapshot);
    return snapshot;
  }
}
