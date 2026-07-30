/**
 * Authority the change set asked for and no work unit uses.
 *
 * WHY THIS EXISTS (2026-07-30). Under the standing approval, an envelope inside
 * the policy is approved with nobody reading it — that is the whole point of
 * ledger Gap 18, and it is a good trade. What it gives up, explicitly, is
 * per-change-set human review of in-policy work. So the thing a reviewer used to
 * catch for free now goes uncaught: a change set that asks for `src` when it only
 * ever touches `src/login` is approved, dispatched, and runs with more authority
 * than the plan needs.
 *
 * That is not a policy violation and must not be treated as one. The policy said
 * `src` is fine, and it is. It is a WIDER GRANT THAN NECESSARY, which is worth
 * telling somebody about and never worth halting a run over — so this reports,
 * and nothing here can refuse anything.
 *
 * Deterministic on purpose. The obvious version of a "critic on auto-approved
 * plans" is another model pass; this is a set difference over paths the plan
 * already declares, so it costs nothing, cannot hallucinate, and gives the same
 * answer every time. A model-based critic can come later for the judgements this
 * cannot make — it does not need to come first.
 */
import type { AuthorizationEnvelope, WorkUnit } from "@crabgic/contracts";

export interface UnusedAuthority {
  /** Envelope-owned paths no work unit claims. */
  readonly unusedOwnedPaths: readonly string[];
  /** True when the envelope grants nothing the plan does not use. */
  readonly tight: boolean;
}

/** Normalizes a declared path for comparison: trailing slashes and `./` prefixes are noise, not intent. */
function normalize(path: string): string {
  return path.trim().replace(/^\.\//, "").replace(/\/+$/, "");
}

/**
 * True when `ownedPath` is at or below `claimed` — segment-aware, so `src`
 * covers `src/login` and never `srcfoo`.
 *
 * Deliberately the same containment shape `isContained` uses for the policy
 * check. A work unit claiming `src/login` genuinely uses the authority an
 * envelope grant of `src` confers, so counting that grant as "unused" would
 * report every nested plan as over-broad and train the reader to ignore this.
 */
function isUsedBy(ownedPath: string, claimed: readonly string[]): boolean {
  const owned = normalize(ownedPath);
  return claimed.some((raw) => {
    const claim = normalize(raw);
    return claim === owned || claim.startsWith(`${owned}/`);
  });
}

/** Finds envelope authority the plan never uses. Reports only; refuses nothing. */
export function findUnusedAuthority(
  envelope: AuthorizationEnvelope,
  workUnits: readonly WorkUnit[],
): UnusedAuthority {
  const claimed = workUnits.flatMap((unit) => unit.ownedPaths);
  const unusedOwnedPaths = envelope.ownedPaths.filter((owned) => !isUsedBy(owned, claimed));
  return { unusedOwnedPaths, tight: unusedOwnedPaths.length === 0 };
}

/**
 * One line for the operator, or `undefined` when the grant is already tight.
 *
 * Says what it is — a wider grant than the plan needs — and explicitly not a
 * policy violation, because the reader's next question is "did something go
 * wrong?" and the answer is no.
 */
export function renderUnusedAuthority(unused: UnusedAuthority): string | undefined {
  if (unused.tight) return undefined;
  return (
    `  note: the envelope grants ${unused.unusedOwnedPaths.length} path(s) no work unit uses ` +
    `(${unused.unusedOwnedPaths.join(", ")}) — inside your standing policy, so nothing is blocked, ` +
    `but the run has more authority than its plan needs\n`
  );
}
