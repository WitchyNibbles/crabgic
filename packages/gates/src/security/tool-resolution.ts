import type { CapabilityStore } from "@eo/detect";
import { MissingCapabilityEntryError, ToolDigestMismatchError } from "../errors.js";

/**
 * Digest-pinned scanner-binary resolution — roadmap/14 §In scope, "Security
 * checks" bullet: "Scanner binaries resolve as digest-pinned entries from
 * 12's content-addressed capability store — never fetched or executed ad
 * hoc." `store` is 12's `CapabilityStore` (`@eo/detect`); `observedDigest`
 * is whatever digest the actual invocation-time binary presents (fixture-
 * modeled for this phase — see the phase-14 evidence doc). Fails CLOSED in
 * both directions: no pinned entry at all (`MissingCapabilityEntryError`),
 * or a pinned entry whose digest no longer matches what was observed
 * (`ToolDigestMismatchError`, "mirrors 12's own unsigned-digest-swap
 * vector," roadmap/14 §Test plan).
 */
export function resolveDigestPinnedTool(
  store: CapabilityStore,
  toolName: string,
  observedDigest: string,
): { readonly toolName: string; readonly digest: string } {
  const entry = store.findLatestByName(toolName);
  if (entry === undefined) {
    throw new MissingCapabilityEntryError(toolName);
  }
  if (entry.report.digest !== observedDigest) {
    throw new ToolDigestMismatchError(toolName, entry.report.digest, observedDigest);
  }
  return { toolName, digest: entry.report.digest };
}
