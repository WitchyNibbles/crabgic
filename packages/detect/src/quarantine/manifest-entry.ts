/**
 * Stage 6 (manifest_entry) — roadmap/12 §In scope, "Quarantine pipeline"
 * bullet: "(6) manifest entry for approval." Builds a `CapabilityManifest`
 * (02) entry for a pinned candidate, always starting `decision: "pending"`
 * — `../trust/` is the only place a decision transitions to `"approved"`/
 * `"rejected"`.
 */
import type { CapabilityManifestEntry } from "@eo/contracts";
import type { CapabilityKind, PinnedCandidate } from "./types.js";

function buildEntry<K extends CapabilityKind>(
  kind: K,
  pinned: PinnedCandidate,
): Extract<CapabilityManifestEntry, { kind: K }> {
  const sourceRef = pinned.provenance?.sourceRef;
  const entry = {
    kind,
    name: pinned.name,
    digest: pinned.digest,
    decision: "pending" as const,
    ...(sourceRef !== undefined ? { sourceRef } : {}),
  };
  // Safe: `CapabilityManifestEntrySchema`'s 5 digest-pinned variants
  // (`digestPinnedEntry<K>`, 02) share IDENTICAL shape apart from the
  // `kind` literal, which `entry.kind` above is set to exactly `K` — this
  // cast just tells TS what it cannot itself infer from a generic literal.
  return entry as Extract<CapabilityManifestEntry, { kind: K }>;
}

/** Builds the `pending` manifest entry for `pinned` — the shape 02's `CapabilityManifestEntrySchema` accepts for `pinned.kind`. */
export function buildManifestEntry(pinned: PinnedCandidate): CapabilityManifestEntry {
  return buildEntry(pinned.kind, pinned);
}
