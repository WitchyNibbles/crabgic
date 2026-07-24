import { JIRA_ACTIONS, type JiraAction } from "../resource-client/actions.js";

/**
 * `DcEditionFeatureMatrix` — roadmap/19-jira-datacenter-adapter.md
 * §Interfaces produced: "maps a discovered DC edition/version to its
 * available fields/actions, feeding `CapabilitySnapshot` (P02); the
 * source of every DC-only typed `unsupported` result." Work item 3,
 * entry point: "a query against an unrecognized edition/version asserts
 * typed `unsupported` before the matrix has any entries to consult (i.e.
 * the safe-default path is proven before real data lands)."
 *
 * This connector's DC coverage targets exactly the two fixture versions
 * roadmap/19 names (10.3, 11.3) — both editions support the FULL
 * `JIRA_ACTIONS` vocabulary in this connector's own scope (18's/19's
 * plan-matrix is a client-side allowlist, not a server capability gap on
 * these particular supported versions); an edition entry with a NARROWER
 * `availableActions` list is how a future, older/newer DC version with a
 * genuine server-side capability gap would be represented, without
 * touching this module's callers.
 */
export interface DcEditionEntry {
  readonly edition: string;
  readonly availableActions: readonly JiraAction[];
  /** Reserved for a future edition whose custom-field surface genuinely differs — populated here as an explicit (currently unconstrained) allowlist rather than left undocumented; every current entry allows every field discovered via `../capability/field-metadata.ts` (that module's own discovered-vs-undiscovered gate is the actual field-level "never guess" enforcement point). */
  readonly availableFields: "discovered-only";
}

/**
 * Closed, explicit list — never derived by pattern (e.g. "any 1x.y"), so
 * adding a THIRD supported DC version is a deliberate, reviewed edit here,
 * never an accidental silent widening.
 */
const DC_EDITION_FEATURE_MATRIX: readonly DcEditionEntry[] = [
  { edition: "10.3", availableActions: JIRA_ACTIONS, availableFields: "discovered-only" },
  { edition: "11.3", availableActions: JIRA_ACTIONS, availableFields: "discovered-only" },
];

/** Exact-match lookup by edition string — `undefined` for anything not on the closed list above, never a fuzzy/prefix guess at this layer (see `normalizeDcEdition` for the ONE place a version STRING is reduced to an edition key). */
export function resolveDcEditionFeatures(edition: string): DcEditionEntry | undefined {
  return DC_EDITION_FEATURE_MATRIX.find((entry) => entry.edition === edition);
}

/**
 * Reduces a raw, discovered `serverInfo.version` string (e.g. `"10.3.1"`)
 * to one of this matrix's known edition keys, by prefix match against the
 * closed list above — NEVER a regex/heuristic guess at an edition this
 * matrix doesn't already list. Returns `"unknown"` (never a fabricated
 * edition string) for anything that doesn't start with a listed edition
 * prefix.
 */
export function normalizeDcEdition(version: string): string {
  const match = DC_EDITION_FEATURE_MATRIX.find((entry) => version.startsWith(entry.edition));
  return match?.edition ?? "unknown";
}

/**
 * `true` iff `action` is listed as available for `edition` — an
 * unrecognized `edition` (absent from the closed matrix above) ALWAYS
 * returns `false`, never a guess and never a raw-endpoint fallback,
 * regardless of what `action` is. The property test in this module's
 * `.test.ts` file fuzzes both parameters to prove this holds for every
 * input, not just the two named fixture editions.
 */
export function isActionSupportedForDcEdition(edition: string, action: JiraAction): boolean {
  const entry = resolveDcEditionFeatures(edition);
  return entry !== undefined && entry.availableActions.includes(action);
}
