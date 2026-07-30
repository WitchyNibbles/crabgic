import { normalizePathPrefix } from "@crabgic/contracts";
import type { AuthorizationEnvelope, EnvelopePolicy } from "@crabgic/contracts";
import { validateOwnedPath } from "../compiler/owned-path.js";

/**
 * `isContained` — the standing approval's gate (interface-ledger Gap 18,
 * part 2), implemented here because roadmap/03 is the design's named security
 * keystone and 02 specifies the predicate it implements.
 *
 * An `AuthorizationEnvelope` is contained iff **every** authority dimension it
 * declares is a subset of the policy's. The answer is all-or-nothing: an
 * envelope that is 90% inside the policy is outside it, and no caller may
 * dispatch the contained subset.
 *
 * FAIL CLOSED, ALWAYS. Every path this function can take ends in a decision,
 * never a throw: a malformed envelope path, a malformed policy prefix and an
 * unrecognised shape all resolve to "not contained". That asymmetry is
 * deliberate — a false negative costs one refused dispatch and a policy edit,
 * while a false positive is an unreviewed run with authority nobody granted.
 *
 * REASONS, NOT A BOOLEAN. A refusal names every dimension that escaped, not
 * the first, because the caller's job is to tell an owner what to add to the
 * policy. Returning one reason at a time would make recovery an iterative
 * guessing game against a gate that has to be edited out-of-band.
 */
export interface ContainmentResult {
  readonly contained: boolean;
  /** Empty iff `contained`. One entry per escaping dimension, each naming the offending value. */
  readonly reasons: readonly string[];
}

/**
 * Normalizes a path the way `validateOwnedPath` does, or returns `undefined`
 * if it is not a legal owned path at all.
 *
 * Both sides of a comparison go through this, which is roast round 1's
 * explicit requirement: comparing a raw policy prefix against a normalized
 * envelope path (or the reverse) makes the same logical path pass or halt
 * depending on how it was typed. Still fail-closed either way, but
 * inconsistently, which is worse to operate than a strict rule.
 */
function normalizePath(raw: string): string | undefined {
  // Delegates to 02's canonical normalizer. Rounds 4-7 showed that a second
  // implementation kept here — however carefully written — diverges from the
  // policy schema's usability predicate somewhere new each time; round 7
  // measured the divergence at 6895 mismatches over a 51,911-prefix corpus.
  // One function, called from both sides, is the only form that cannot drift.
  //
  // `validateOwnedPath` still runs FIRST, because it is 03's own boundary and
  // carries this phase's security history; the shared normalizer then decides
  // comparability.
  try {
    validateOwnedPath(raw);
  } catch {
    return undefined;
  }
  return normalizePathPrefix(raw);
}

/**
 * Segment-aware prefix containment: `src` contains `src` and `src/login`, and
 * does **not** contain `srcfoo` or `src-secrets/keys`.
 *
 * Deliberately not glob matching. `validateOwnedPath` already rejects every
 * glob metacharacter because owned paths are literal directory names, and a
 * second, richer matching language on this surface is exactly where this
 * phase's CRITICAL owned-path confinement escape lived.
 */
function pathContained(ownedPath: string, allowedPrefixes: readonly string[]): boolean {
  const owned = normalizePath(ownedPath);
  if (owned === undefined) return false;

  return allowedPrefixes.some((rawPrefix) => {
    const prefix = normalizePath(rawPrefix);
    if (prefix === undefined) return false;
    return owned === prefix || owned.startsWith(`${prefix}/`);
  });
}

/** Exact-set membership over trimmed values — used for every non-path dimension. */
function exactlyContained(value: string, allowed: readonly string[]): boolean {
  const trimmed = value.trim();
  return allowed.some((entry) => entry.trim() === trimmed);
}

export function isContained(
  envelope: AuthorizationEnvelope,
  policy: EnvelopePolicy,
): ContainmentResult {
  const reasons: string[] = [];

  // A policy prefix that cannot be normalized grants nothing, for ever. Say
  // so explicitly and FIRST: roast round 2 (F4) showed that
  // `allowedPathPrefixes: ["src/**"]` — the natural way to write "everything
  // under src" — parses, is not vacuous, passes every doctor check, matches
  // nothing, and was then reported as `owned path "src/login" is not at or
  // below any allowed path prefix`. That names the envelope and never says
  // the prefix itself was rejected, sending the owner to fix the wrong file
  // at a gate they must edit out-of-band.
  const unusablePrefixes = policy.allowedPathPrefixes.filter(
    (prefix) => normalizePath(prefix) === undefined,
  );
  for (const prefix of unusablePrefixes) {
    reasons.push(
      `policy path prefix ${JSON.stringify(prefix)} is not a usable worktree-relative directory ` +
        `(absolute, home-anchored, containing "..", or containing glob metacharacters), so it grants nothing`,
    );
  }

  for (const ownedPath of envelope.ownedPaths) {
    if (!pathContained(ownedPath, policy.allowedPathPrefixes)) {
      reasons.push(
        `owned path ${JSON.stringify(ownedPath)} is not at or below any allowed path prefix`,
      );
    }
  }

  for (const command of envelope.commands) {
    if (!exactlyContained(command, policy.allowedCommands)) {
      reasons.push(`command ${JSON.stringify(command)} is not an allowed command`);
    }
  }

  for (const destination of envelope.networkDestinations) {
    if (!exactlyContained(destination, policy.allowedNetworkDestinations)) {
      reasons.push(
        `network destination ${JSON.stringify(destination)} is not an allowed destination`,
      );
    }
  }

  for (const reference of envelope.credentialReferences) {
    if (!exactlyContained(reference, policy.allowedCredentialReferences)) {
      reasons.push(`credential reference ${JSON.stringify(reference)} is not an allowed reference`);
    }
  }

  // Keyed on the REFERENCE, never on `highImpactFlags`. Roast round 1 (F2/F3)
  // established that the flag taxonomy is assigned by static per-kind tables
  // rather than by risk — a Grafana `dashboard` and a Jira single-issue update
  // both carry no flag — and that `requiredCapabilityFlags` has no consumer at
  // apply time. So an authorization carrying zero flags is NOT trivially safe,
  // and any remote authorization escalates unless the policy names it.
  for (const authorization of envelope.remoteResourceAuthorizations) {
    if (!exactlyContained(authorization.reference, policy.allowedRemoteResourceReferences)) {
      reasons.push(
        `remote resource ${JSON.stringify(authorization.reference)} is not an allowed remote resource`,
      );
    }
  }

  // Worker turn budget (adaptation §5.7: turns are the authoritative unit).
  // The request must be a positive integer at or below the policy's ceiling;
  // anything malformed on EITHER side fails closed — a NaN smuggled past the
  // schema must never read as contained, and a malformed ceiling grants
  // nothing rather than everything. A pre-existing policy that never stated a
  // ceiling parses to 0 (the schema's F10 fail-closed default) and escapes
  // here, naming the field the owner has to set.
  const requestedTurns = envelope.maxTurnsPerAttempt;
  const grantedTurns = policy.maxWorkerTurnsPerAttempt;
  if (
    !Number.isInteger(requestedTurns) ||
    requestedTurns <= 0 ||
    !Number.isInteger(grantedTurns) ||
    grantedTurns < 0 ||
    requestedTurns > grantedTurns
  ) {
    reasons.push(
      `worker turn budget: the envelope requests ${String(requestedTurns)} turns per attempt ` +
        `but the policy grants up to ${String(grantedTurns)} ` +
        `(set "maxWorkerTurnsPerAttempt" in the standing policy to grant more)`,
    );
  }

  // `dependencies`, `temporaryServices` and `prohibitedActions` are read by no
  // consumer anywhere in the system (roast F5/F14) and are deliberately not
  // gated here. Crediting `prohibitedActions` as a narrowing in particular
  // would be reasoning about an enforcement that does not exist: its only
  // reader was the human this ruling removes, and the model authoring the
  // intake controls the field.

  return { contained: reasons.length === 0, reasons };
}
