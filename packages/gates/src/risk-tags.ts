import { INTENT_CONTRACT_SECTION_KEYS, type IntentContractSectionKey } from "@eo/contracts";

/**
 * The risk-tag vocabulary the gate registry is keyed by — roadmap/14-quality-
 * security-gates.md §In scope, "Gate framework & registry" bullet: "tags are
 * `IntentContract`'s named sections ... plus this phase's own always-on
 * default tags `tdd`, `coverage`, `flake`, `engine-conformance`."
 *
 * `IntentContractSectionKey` (`@eo/contracts`,
 * `packages/contracts/src/contracts/intent-contract.ts`) is the 9-member
 * closed list (`scope, non-goals, audience, compatibility, security,
 * performance, observability, rollout, acceptance`) — that file's own doc
 * comment already states it is "reconfirmed by roadmap/14 ... which keys its
 * risk-tag vocabulary off this exact list," so this module imports it rather
 * than re-declaring a second copy. (Deviation note: this phase's own brief
 * describes the vocabulary as "11 section names" in prose; the actual,
 * shipped `@eo/contracts` schema — the authoritative source this file is
 * required to key off — has exactly 9. This module follows the schema, not
 * the miscounted prose, and the discrepancy is called out in the phase-14
 * evidence doc.)
 *
 * `security` is explicitly SHARED (14's own SAST/secret/dependency scanners
 * register under it alongside 21's connector-security fixtures); `performance`
 * is used exclusively by 15's registered gate — this phase contributes
 * nothing under it, but the tag itself is still part of the closed
 * vocabulary every registrant (including 15) dispatches against.
 */
export const GATE_RISK_TAGS = [
  ...INTENT_CONTRACT_SECTION_KEYS,
  "tdd",
  "coverage",
  "flake",
  "engine-conformance",
] as const;

export type GateRiskTag = (typeof GATE_RISK_TAGS)[number];

/** This phase's own always-on default tags — fire regardless of which `IntentContract` sections a `ChangeSet` happens to populate. */
export const DEFAULT_GATE_RISK_TAGS = ["tdd", "coverage", "flake", "engine-conformance"] as const;

export function isGateRiskTag(value: string): value is GateRiskTag {
  return (GATE_RISK_TAGS as readonly string[]).includes(value);
}

/** Re-exported for convenience so callers keying gates off `IntentContract` sections don't need a second `@eo/contracts` import just for the type. */
export type { IntentContractSectionKey };
