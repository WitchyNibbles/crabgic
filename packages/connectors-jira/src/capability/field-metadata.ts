import { ConnectorError } from "@crabgic/contracts";
import { JIRA_DATACENTER_PROVIDER_NAME, JIRA_PROVIDER_NAME } from "../errors/jira-error-mapping.js";
import type { JiraFieldMetadata } from "../resource-client/types.js";

/**
 * Field-metadata-driven custom-field write validation — roadmap/18 §In
 * scope: "custom-field writes only against discovered field metadata."
 * Work item 3, §Test plan Property bullet: "an unrecognized field type
 * must never be silently accepted for a custom-field write."
 *
 * Every Jira field id prefixed `customfield_` in a write payload must (a)
 * appear in field metadata this connector has actually discovered
 * (`GET /rest/api/3/field`, `../capability/discovery.ts`) and (b) carry a
 * schema `type` this connector recognizes — an unrecognized type (a
 * future Jira field kind this connector has never been taught about) is
 * refused, never silently passed through as an opaque write.
 * Non-custom (built-in) fields are never gated here — Jira's built-in
 * field set is stable and covered by this connector's own typed request
 * builders directly.
 */
export const KNOWN_JIRA_FIELD_SCHEMA_TYPES = [
  "string",
  "number",
  "array",
  "option",
  "user",
  "date",
  "datetime",
  "priority",
  "issuetype",
  "project",
  "any",
] as const;

export type JiraFieldSchemaType = (typeof KNOWN_JIRA_FIELD_SCHEMA_TYPES)[number];

export function isKnownJiraFieldSchemaType(value: string): value is JiraFieldSchemaType {
  return (KNOWN_JIRA_FIELD_SCHEMA_TYPES as readonly string[]).includes(value);
}

export interface FieldMetadataIndex {
  get(fieldId: string): JiraFieldMetadata | undefined;
}

export function buildFieldMetadataIndex(fields: readonly JiraFieldMetadata[]): FieldMetadataIndex {
  const byId = new Map(fields.map((f) => [f.id, f]));
  return { get: (fieldId) => byId.get(fieldId) };
}

const CUSTOM_FIELD_ID_PREFIX = "customfield_";

/**
 * How a custom-field refusal from `assertCustomFieldWritesAreDiscovered` is
 * attributed on 02's canonical connector-error taxonomy.
 *
 * **The spec was silent and the silence is filled by a ruling here.** This
 * gate is shared verbatim by both Jira deployment types (18's Cloud plan
 * builders in `../resource-client/issue-plans.ts` are reused unforked by
 * 19's Data Center client), but the two roadmaps ask for DIFFERENT canonical
 * kinds for the same refusal:
 *
 * - **Cloud (18)** frames it as input validation — §In scope, "custom-field
 *   writes only against discovered field metadata", §Test plan Security,
 *   "custom-field writes refuse undiscovered field IDs". Nothing in 18 names
 *   a canonical kind, so Cloud keeps `validation`, which is what it has
 *   always thrown. **This default is deliberate and load-bearing: it is not
 *   a leftover.**
 * - **Data Center (19)** names the kind explicitly and twice — §In scope,
 *   "Unrecognized fields or actions return typed `unsupported` (P02) — never
 *   guessed, never a raw-endpoint fallback", and exit criterion 2, "DC-only
 *   unsupported actions/**fields** return typed `unsupported`". A DC
 *   connection's undiscovered field is a *capability* statement about that
 *   edition, not a statement that the caller's input was malformed.
 *
 * The provider member exists for a second, independent reason: before this
 * parameterization both throws hardcoded `JIRA_PROVIDER_NAME`, so a **Data
 * Center** connection's field rejection was attributed to **Cloud**
 * (measured 2026-08-04, defect
 * `19-unsupported-fields-and-cassette-conjuncts`). That is a bug on either
 * reading of the kind question. `../resource-client/datacenter/jira-datacenter-resource-client.ts`
 * had already fixed the same class of mis-attribution for unsafe-ADF
 * rejections by pre-checking with the DC provider name at its plan-build
 * boundary; the custom-field path now gets the identical treatment.
 *
 * ⚠️ Both members are part of the ruling. Changing either one silently
 * changes what a caller sees: 21's `remote_verification` gate treats
 * `unsupported` as run-blocking, and 16's capability-snapshot cache
 * invalidates a connection on `unsupported`. Both settings are pinned by
 * `./field-metadata.test.ts` and, end to end through the real clients, by
 * `../resource-client/datacenter/jira-datacenter-resource-client.test.ts`.
 */
export interface CustomFieldRefusalAttribution {
  readonly kind: "validation" | "unsupported";
  readonly provider: string;
}

/** Jira **Cloud** attribution — the default. See `CustomFieldRefusalAttribution` for why 18 and 19 differ. */
export const CLOUD_CUSTOM_FIELD_REFUSAL: CustomFieldRefusalAttribution = {
  kind: "validation",
  provider: JIRA_PROVIDER_NAME,
};

/** Jira **Data Center** attribution — roadmap/19 §In scope's "Unrecognized fields or actions return typed `unsupported` (P02)". See `CustomFieldRefusalAttribution`. */
export const DATACENTER_CUSTOM_FIELD_REFUSAL: CustomFieldRefusalAttribution = {
  kind: "unsupported",
  provider: JIRA_DATACENTER_PROVIDER_NAME,
};

function refuseCustomFieldWrite(
  attribution: CustomFieldRefusalAttribution,
  message: string,
): never {
  const input = { message, provider: attribution.provider, retryable: false };
  throw attribution.kind === "unsupported"
    ? ConnectorError.unsupported(input)
    : ConnectorError.validation(input);
}

/**
 * Throws a canonical `ConnectorError` synchronously (no I/O) if `fields`
 * writes any custom field id that is either undiscovered or carries an
 * unrecognized schema type. Standard (non-`customfield_`-prefixed) keys
 * are never inspected here.
 *
 * `attribution` selects the refusal's canonical kind and provider and
 * defaults to Cloud's — see `CustomFieldRefusalAttribution` for the ruling
 * behind the two settings. Callers on a Data Center connection pass
 * `DATACENTER_CUSTOM_FIELD_REFUSAL`.
 */
export function assertCustomFieldWritesAreDiscovered(
  fields: Readonly<Record<string, unknown>>,
  index: FieldMetadataIndex,
  attribution: CustomFieldRefusalAttribution = CLOUD_CUSTOM_FIELD_REFUSAL,
): void {
  for (const fieldId of Object.keys(fields)) {
    if (!fieldId.startsWith(CUSTOM_FIELD_ID_PREFIX)) continue;

    const metadata = index.get(fieldId);
    if (metadata === undefined) {
      refuseCustomFieldWrite(
        attribution,
        `custom field "${fieldId}" is not present in discovered field metadata`,
      );
    }
    if (!isKnownJiraFieldSchemaType(metadata.schemaType)) {
      refuseCustomFieldWrite(
        attribution,
        `custom field "${fieldId}" has an unrecognized schema type "${metadata.schemaType}"`,
      );
    }
  }
}
