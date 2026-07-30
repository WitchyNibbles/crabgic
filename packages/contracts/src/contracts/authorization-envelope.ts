import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";
import { HighImpactCapabilityFlagSchema } from "../capability-flags/high-impact-capability-flag.js";

/**
 * One remote-resource authorization within an `AuthorizationEnvelope`.
 * `reference` is a free-text pointer to the remote resource (e.g. a Jira
 * issue key, a Grafana dashboard UID) rather than an `IdSchema` reference to
 * `RemoteResource` (02's contract, owned elsewhere) because authorization
 * frequently precedes the `RemoteResource` record's own creation — the
 * envelope is compiled from a human-reviewed plan that may name a resource
 * before any connector has resolved it to a tracked entity (minimal-shape
 * choice). `highImpactFlags` surfaces `HighImpactCapabilityFlag`
 * (../capability-flags/high-impact-capability-flag.ts) labels verbatim, per
 * roadmap/11-intake-contract-approval.md §In scope, "AuthorizationEnvelope"
 * bullet: "high-impact flags surfaced using 02's canonical labels, e.g.
 * `closing transitions`, `bulk mutations` — never a connector-specific
 * gloss" (interface-ledger Gap 10).
 */
export const RemoteResourceAuthorizationSchema = z
  .object({
    reference: NonEmptyStringSchema,
    highImpactFlags: z.array(HighImpactCapabilityFlagSchema),
  })
  .strict();
export type RemoteResourceAuthorization = z.infer<typeof RemoteResourceAuthorizationSchema>;

/**
 * `AuthorizationEnvelope` (roadmap/02-contracts-and-schemas.md §Interfaces
 * produced, row "AuthorizationEnvelope | 03 (compiler input), 06, 09, 11,
 * 13"): the sole input to 03's `compileEnvelope` function
 * (roadmap/03-envelope-compiler-engine-adapter.md §In scope, "Envelope
 * compiler" bullet). Field list drawn verbatim from
 * roadmap/11-intake-contract-approval.md §In scope, "AuthorizationEnvelope"
 * bullet: "commands, paths, network destinations, credential references,
 * dependencies, remote resources ..., temporary services, prohibited
 * actions; canonical hash-stable form."
 *
 * - `ownedPaths`/`commands` feed 03's permission-profile emission (`Edit`/
 *   `Write` allow entries and `Bash(...)` command-prefix allow entries,
 *   roadmap/03 §In scope, "Envelope compiler" bullet) — note 03's own
 *   mandatory 4 `Bash(...)` literals and mandatory denies are compiler-
 *   injected constants, not carried on the envelope itself; this schema's
 *   `commands` is only the *additional* set the envelope explicitly
 *   authorizes.
 * - `networkDestinations` feeds the compiled sandbox profile's
 *   `network.allowedDomains` (roadmap/03 §In scope, same bullet: "only from
 *   the envelope").
 * - `credentialReferences` are references only, never raw secret values —
 *   mirrors roadmap/09-cli-and-doctor.md §In scope's "Secret-reference
 *   argument type" convention used throughout this system.
 * - `dependencies`: free-text external package/tool names the envelope
 *   authorizes a worker to install or use (minimal shape chosen — roadmap/11
 *   names "dependencies" as a field but does not pin a closed taxonomy or
 *   structured shape for it).
 * - `canonicalHash` is the "canonical hash-stable form" roadmap/11 cites,
 *   and is what 11's amendment flow compares against ("material change → new
 *   envelope hash → prior token invalidated", roadmap/11 §In scope, work
 *   item 5) and what 11's own Test plan exercises ("canonical-hash stability
 *   and perturbation-sensitivity of `AuthorizationEnvelope`").
 */
/**
 * The per-attempt worker turn budget an envelope requests when it does not
 * state one. One definition site: the intake builder resolves an absent
 * request to this before hashing, and the dispatcher's packet compilation
 * reads the resolved envelope field — nothing else may restate the number.
 * 40 is the cap the dispatcher had hardcoded (un-governed) before the budget
 * became an authority dimension.
 */
export const DEFAULT_MAX_TURNS_PER_ATTEMPT = 40;

export const AuthorizationEnvelopeSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    id: IdSchema,
    changeSetId: IdSchema,
    createdAt: TimestampSchema,
    canonicalHash: NonEmptyStringSchema,
    ownedPaths: z.array(NonEmptyStringSchema),
    commands: z.array(NonEmptyStringSchema),
    networkDestinations: z.array(NonEmptyStringSchema),
    credentialReferences: z.array(NonEmptyStringSchema),
    dependencies: z.array(NonEmptyStringSchema),
    remoteResourceAuthorizations: z.array(RemoteResourceAuthorizationSchema),
    temporaryServices: z.array(NonEmptyStringSchema),
    prohibitedActions: z.array(NonEmptyStringSchema),
    /**
     * Per-attempt engine turn budget this envelope REQUESTS (turns are the
     * authoritative budget unit; USD figures stay informational — adaptation
     * §5.7). Tested for containment against the standing policy's
     * `maxWorkerTurnsPerAttempt` like every other authority dimension, and
     * compiled into each `TaskPacket.resourceLimits.maxTurns`, where the
     * engine enforces it.
     *
     * Absent DEFAULTS (it does not mean "unconstrained"): an envelope written
     * before this axis existed asks for the bounded
     * `DEFAULT_MAX_TURNS_PER_ATTEMPT`. The F10 absent-means-deny ruling binds
     * POLICY fields, where absence would otherwise widen authority; on the
     * requesting side absence narrows to the default.
     */
    maxTurnsPerAttempt: z.number().int().positive().default(DEFAULT_MAX_TURNS_PER_ATTEMPT),
  })
  .strict();
export type AuthorizationEnvelope = z.infer<typeof AuthorizationEnvelopeSchema>;
