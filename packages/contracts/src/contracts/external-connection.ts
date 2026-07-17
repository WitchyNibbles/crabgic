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

    /** roadmap/16 §In scope: "tenant/.../allowlists" (tenant scoping). */
    tenantAllowlist: z.array(NonEmptyStringSchema).readonly().optional(),
    /** roadmap/16 §In scope: ".../org/.../allowlists" (Grafana org scoping). */
    orgAllowlist: z.array(NonEmptyStringSchema).readonly().optional(),
    /** roadmap/16 §In scope: ".../project/.../allowlists" (Jira project scoping). */
    projectAllowlist: z.array(NonEmptyStringSchema).readonly().optional(),
    /** roadmap/16 §In scope: ".../folder allowlists" (Grafana folder scoping). */
    folderAllowlist: z.array(NonEmptyStringSchema).readonly().optional(),

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
