import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema } from "../shared/ids.js";

/**
 * A reference to a secret credential — never the credential itself.
 * roadmap/16-gateway-core.md §In scope, `ExternalConnection` store bullet:
 * "secret references only (env, file 0600, exec backends; extensible) —
 * never a literal credential in worker- or manager-reachable state." Three
 * backends are named there; "extensible" describes 16's own resolver
 * design intent (16 owns adding a resolver for a new backend), not an
 * obligation on this closed shape — a 4th backend is a coordinated schema
 * change here, like any other closed union in this package. No branch
 * carries a literal secret value field — only a pointer to where the real
 * value lives (an env var name, a file path, or a command to run).
 */
export const SecretReferenceSchema = z.discriminatedUnion("backend", [
  z.object({ backend: z.literal("env"), variable: NonEmptyStringSchema }).strict(),
  z.object({ backend: z.literal("file"), path: NonEmptyStringSchema }).strict(),
  z
    .object({
      backend: z.literal("exec"),
      command: NonEmptyStringSchema,
      args: z.array(NonEmptyStringSchema).readonly().optional(),
    })
    .strict(),
]);
export type SecretReference = z.infer<typeof SecretReferenceSchema>;

/**
 * A reference to a custom CA certificate file used to validate a
 * connection's TLS chain (roadmap/16 §In scope: "custom CA reference") —
 * never the certificate bytes themselves, matching `SecretReferenceSchema`'s
 * own reference-not-literal discipline.
 */
export const CustomCaReferenceSchema = z.object({ path: NonEmptyStringSchema }).strict();
export type CustomCaReference = z.infer<typeof CustomCaReferenceSchema>;

/**
 * `ExternalConnection` — roadmap/02-contracts-and-schemas.md §Interfaces
 * produced table: "consumed by 16 (store), 09, 18, 19, 20." Field list
 * derived verbatim from roadmap/16-gateway-core.md §In scope's
 * `ExternalConnection` store bullet: "provider, deployment type, exact
 * HTTPS base URL, allowed redirect origins, tenant/org/project/folder
 * allowlists, custom CA reference, allowed resources/actions, discovery
 * TTL; secret references only ... never a literal credential in worker- or
 * manager-reachable state."
 *
 * `provider` and `deploymentType` are deliberately opaque, extensible
 * strings, not closed unions: 16's own text describes provider dispatch as
 * "a provider-keyed extension point," and roadmap/19 introduces a
 * provider-specific closed union (`JiraDeploymentType`, `"cloud" |
 * "datacenter"`) layered on top of this generic field inside that phase's
 * own `JiraConnectionConfig` — 19 states explicitly "no change to
 * `ExternalConnection` itself." Enumerating provider/deployment values here
 * would preempt that per-connector ownership.
 */
export const ExternalConnectionSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    id: IdSchema,

    /** roadmap/16 §In scope: "provider" — the provider-dispatch key (16's provider-keyed extension point inside `tracker.*`/`observability.*`). */
    provider: NonEmptyStringSchema,

    /**
     * roadmap/16 §In scope: "deployment type" — provider-interpreted opaque
     * string (e.g. Jira's cloud/datacenter, Grafana's cloud/oss/enterprise).
     * Optional: some providers derive routing from live discovery instead of
     * a declared deployment type (roadmap/20's Grafana version-aware
     * routing "by capability, not major version").
     */
    deploymentType: NonEmptyStringSchema.optional(),

    /** roadmap/16 §In scope: "exact HTTPS base URL." */
    baseUrl: z
      .string()
      .url()
      .refine((url) => url.startsWith("https://"), { message: "baseUrl must use https://" }),

    /** roadmap/16 §In scope: "allowed redirect origins" — the SSRF-guard allowlist a redirect target must match before credentials attach. */
    allowedRedirectOrigins: z.array(z.string().url()).readonly(),

    /**
     * roadmap/16 §In scope: "tenant/.../allowlists" (tenant scoping).
     *
     * ENFORCED since 2026-08-05 (defect 21 — this field was previously
     * declared, published, and read by no code at all). The gateway's
     * mutation pipeline (`packages/gateway/src/mutation-pipeline/
     * mutation-pipeline.ts`, `executeMutationPlan` — the sole issuer of
     * mutation network I/O) compares `RemoteMutationPlan.tenant` against
     * this list and refuses a non-member with the canonical
     * `policy_blocked` error kind, before any network I/O and before any
     * `RemoteOperationRecord` is journalled.
     *
     * Three states, all deliberate:
     *  - ABSENT — the connection is tenant-unscoped; no check runs.
     *  - `[]`   — refuses EVERY mutation (fail-closed). Same reading the
     *             Grafana connection doctor already gives an empty
     *             `orgAllowlist` (`packages/connectors-grafana/src/auth/
     *             connection-doctor.ts`): an empty allowlist is a
     *             deliberate "nothing is permitted", never "no opinion".
     *  - non-empty — only these tenants may be the declared target of a
     *             mutation plan on this connection.
     *
     * SCOPE — read this before trusting the field. It binds the tenant a
     * mutation plan DECLARES, on the mutation path only. It does NOT:
     *  - check reads. Read requests carry pseudo-tenants (`"oauth"`,
     *    `"doctor-probe"`, or the connection id) used purely as concurrency
     *    keys, so a request-level read check is not coherent today.
     *  - verify the remote's ACTUAL tenant identity. Nothing here proves the
     *    resolved credential is bound to a listed tenant; that is
     *    provider-specific connection-doctor work.
     * So this field is not "cross-tenant access is refused". It is "an
     * operator can bound which tenant a write may claim to target."
     */
    tenantAllowlist: z
      .array(NonEmptyStringSchema)
      .readonly()
      .optional()
      .describe(
        "Tenant scoping (roadmap/16 §In scope). Enforced by the gateway mutation pipeline: a RemoteMutationPlan whose declared `tenant` is not a member is refused with the canonical `policy_blocked` error kind before any network I/O and before any RemoteOperationRecord is journalled. An empty array refuses every mutation (fail-closed); the field being absent means the connection is tenant-unscoped and no check runs. SCOPE: this binds the tenant a mutation plan DECLARES, on the mutation path only. Reads are not tenant-checked (read requests carry pseudo-tenants used only as concurrency keys), and the remote's actual tenant identity is not verified by this field. It is not a guarantee that cross-tenant access is refused.",
      ),
    /** roadmap/16 §In scope: ".../org/.../allowlists" (Grafana org scoping). */
    orgAllowlist: z.array(NonEmptyStringSchema).readonly().optional(),
    /** roadmap/16 §In scope: ".../project/.../allowlists" (Jira project scoping). */
    projectAllowlist: z.array(NonEmptyStringSchema).readonly().optional(),
    /**
     * roadmap/16 §In scope: ".../folder allowlists" (Grafana folder scoping).
     *
     * ENFORCED since 2026-08-06 (defect 16 — the third declared-and-inert
     * sibling of `tenantAllowlist`, previously published and read by no code
     * at all). The gateway's mutation pipeline
     * (`packages/gateway/src/mutation-pipeline/mutation-pipeline.ts`,
     * `executeMutationPlan`) asks the provider where the mutation lands and
     * refuses a non-member with the canonical `policy_blocked` error kind,
     * before any network I/O and before any `RemoteOperationRecord` is
     * journalled.
     *
     * Three states, the first two identical to `tenantAllowlist`'s:
     *  - ABSENT — the connection is folder-unscoped; no check runs.
     *  - `[]`   — refuses EVERY mutation (fail-closed). An empty allowlist is
     *             a deliberate "nothing is permitted", never "no opinion".
     *  - non-empty — only a mutation the provider places INSIDE a listed
     *             folder is admitted.
     *
     * THE THIRD STATE THAT `tenantAllowlist` DOES NOT HAVE. A plan's tenant
     * is a required `RemoteMutationPlan` field; a folder is not on the plan
     * at all, so the pipeline asks the provider, and a provider may answer
     * "not inside any folder" (an org-level resource) or "I cannot tell".
     * Both are REFUSED under a declared allowlist. Consequence, stated so it
     * is not rediscovered as a bug: a provider with no folder concept —
     * 18/19's Jira — supplies no attribution, so declaring a
     * `folderAllowlist` on a Jira connection refuses every mutation on it.
     * The alternative (admit when unattributable) would leave this field
     * binding only providers that opted in, which is the inert-control shape
     * this enforcement exists to remove.
     *
     * SCOPE — read this before trusting the field. It binds the folder a
     * provider derives FROM THE PLAN, on the mutation path only. It does NOT
     * check reads, and it does NOT verify where the resource actually lives
     * on the remote. So this field is not "writes outside these folders are
     * impossible". It is "an operator can bound which folder a write may
     * claim to land in."
     */
    folderAllowlist: z
      .array(NonEmptyStringSchema)
      .readonly()
      .optional()
      .describe(
        "Folder scoping (roadmap/16 §In scope). Enforced by the gateway mutation pipeline: a RemoteMutationPlan the provider places outside this list is refused with the canonical `policy_blocked` error kind before any network I/O and before any RemoteOperationRecord is journalled. An empty array refuses every mutation (fail-closed); the field being absent means the connection is folder-unscoped and no check runs. A folder is not a RemoteMutationPlan field, so the pipeline asks the provider where the mutation lands; a provider that answers 'not inside any folder' or 'cannot tell' — including one with no folder concept at all, such as the Jira adapters — is REFUSED under a declared allowlist, never admitted. SCOPE: this binds the folder a provider derives from the plan, on the mutation path only. Reads are not folder-checked, and where the resource actually lives on the remote is not verified. It is not a guarantee that writes outside these folders are impossible.",
      ),

    /** roadmap/16 §In scope: "custom CA reference." */
    customCaRef: CustomCaReferenceSchema.optional(),

    /** roadmap/16 §In scope: "allowed resources/actions" (resource half) — the plan-matrix allowlist (e.g. 18's "Resources (plan matrix)" bullet is this field's Jira instantiation). */
    allowedResources: z.array(NonEmptyStringSchema).readonly(),
    /** roadmap/16 §In scope: "allowed resources/actions" (actions half). */
    allowedActions: z.array(NonEmptyStringSchema).readonly(),

    /** roadmap/16 §In scope: "discovery TTL" — overrides/echoes the 15-min `CapabilitySnapshot` cache default (16) for this connection. */
    discoveryTtlSeconds: z.number().int().positive(),

    /** roadmap/16 §In scope: "secret references only ... never a literal credential in worker- or manager-reachable state." */
    secretRef: SecretReferenceSchema,
  })
  .strict();

export type ExternalConnection = z.infer<typeof ExternalConnectionSchema>;
