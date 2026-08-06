/**
 * `AuthorizationEnvelope` builder — roadmap/11-intake-contract-approval.md
 * §In scope, "AuthorizationEnvelope" bullet; §Work items 2 & 5: "two builds
 * of an identical fixture repo produce byte-identical envelope hashes; a
 * one-field mutation changes the hash" / "material change -> new envelope
 * hash -> prior token invalidated -> fresh mint required."
 *
 * `canonicalHash` is computed over every CONTENT field only — `id` and
 * `createdAt` are excluded so that re-serializing the identical content at
 * a later instant (a fresh `id`/timestamp) still lands on the same hash;
 * the hash identifies the envelope's AUTHORIZATION CONTENT, not its
 * storage-record identity. This is what makes amendment detection work:
 * `buildAuthorizationEnvelope` called twice with identical `content` always
 * yields the same `canonicalHash`, and changing any one content field
 * always yields a different one (09's `ApprovalTokenMinter` binds a token
 * to exactly this hash, so a stale token naturally fails re-verification
 * against a new hash with no extra bookkeeping required — see
 * `./amendment.ts`).
 */
import {
  AuthorizationEnvelopeSchema,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_MAX_TURNS_PER_ATTEMPT,
  type AuthorizationEnvelope,
  type RemoteResourceAuthorization,
} from "@crabgic/contracts";
import { canonicalHash } from "./canonical-hash.js";

export interface AuthorizationEnvelopeContent {
  readonly ownedPaths: readonly string[];
  readonly commands: readonly string[];
  readonly networkDestinations: readonly string[];
  readonly credentialReferences: readonly string[];
  readonly dependencies: readonly string[];
  readonly remoteResourceAuthorizations: readonly RemoteResourceAuthorization[];
  readonly temporaryServices: readonly string[];
  readonly prohibitedActions: readonly string[];
  /**
   * Per-attempt worker turn budget the intake requests. OPTIONAL on the
   * request side; an absent value resolves to `DEFAULT_MAX_TURNS_PER_ATTEMPT`
   * BEFORE hashing, so "asked for nothing" and "asked for the default
   * explicitly" are the same authorization content and land on the same
   * canonical hash.
   */
  readonly maxTurnsPerAttempt?: number;
  /**
   * Canonical hash of the provisional performance-budget set this envelope
   * authorizes enforcement of — interface-ledger Gap 22 (2026-08-06).
   * REQUIRED here, and unrepresentable on `IntakeRequest`
   * (`../intake/intake-pipeline.ts`'s `RequestedEnvelopeContent` omits it):
   * `buildIntakeArtifacts` derives it from the provisional
   * `PerformanceContract` it builds in the same assembly, off the SAME hash
   * call, so a consistent intake cannot produce a divergent pair. Gap 21's
   * derived-never-declared posture, extended from provenance to the binding.
   *
   * Hashed by `hashEnvelopeContent`, so the approval token signs it — that is
   * the whole point: before this, the token signed authority fields only and
   * an approval rendered over budget A could be spent enforcing budget B with
   * no edit anywhere for a tamper check to find.
   */
  readonly provisionalBudgetHash: string;
}

/** The resolved turn budget a piece of content actually requests — one definition, used by both the hash and the built record so they can never disagree. */
function resolveMaxTurnsPerAttempt(content: AuthorizationEnvelopeContent): number {
  return content.maxTurnsPerAttempt ?? DEFAULT_MAX_TURNS_PER_ATTEMPT;
}

export interface BuildAuthorizationEnvelopeOptions {
  readonly id: string;
  readonly changeSetId: string;
  readonly createdAt: string;
  readonly content: AuthorizationEnvelopeContent;
}

/** Computes the canonical hash for a piece of envelope content, independent of any particular envelope record — reused by `./amendment.ts` to compare a candidate amendment's content against the currently-stored envelope's hash before deciding whether it is material. */
export function hashEnvelopeContent(content: AuthorizationEnvelopeContent): string {
  return canonicalHash({
    ownedPaths: content.ownedPaths,
    commands: content.commands,
    networkDestinations: content.networkDestinations,
    credentialReferences: content.credentialReferences,
    dependencies: content.dependencies,
    remoteResourceAuthorizations: content.remoteResourceAuthorizations.map((r) => ({
      reference: r.reference,
      highImpactFlags: r.highImpactFlags,
    })),
    temporaryServices: content.temporaryServices,
    prohibitedActions: content.prohibitedActions,
    maxTurnsPerAttempt: resolveMaxTurnsPerAttempt(content),
    // Last, deliberately: `canonicalStringify` sorts keys recursively so the
    // position cannot affect the digest, but keeping it last here and in the
    // built record below keeps the committed goldens tidy to read.
    provisionalBudgetHash: content.provisionalBudgetHash,
  });
}

/** Builds a schema-valid `AuthorizationEnvelope` with a content-derived `canonicalHash`. */
export function buildAuthorizationEnvelope(
  options: BuildAuthorizationEnvelopeOptions,
): AuthorizationEnvelope {
  const envelope: AuthorizationEnvelope = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: options.id,
    changeSetId: options.changeSetId,
    createdAt: options.createdAt,
    canonicalHash: hashEnvelopeContent(options.content),
    ownedPaths: [...options.content.ownedPaths],
    commands: [...options.content.commands],
    networkDestinations: [...options.content.networkDestinations],
    credentialReferences: [...options.content.credentialReferences],
    dependencies: [...options.content.dependencies],
    remoteResourceAuthorizations: [...options.content.remoteResourceAuthorizations],
    temporaryServices: [...options.content.temporaryServices],
    prohibitedActions: [...options.content.prohibitedActions],
    maxTurnsPerAttempt: resolveMaxTurnsPerAttempt(options.content),
    provisionalBudgetHash: options.content.provisionalBudgetHash,
  };
  return AuthorizationEnvelopeSchema.parse(envelope);
}
