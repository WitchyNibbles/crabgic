import { ConnectorError } from "@eo/contracts";
import { JIRA_PROVIDER_NAME } from "../errors/jira-error-mapping.js";
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
 * Throws `ConnectorError.validation` synchronously (no I/O) if `fields`
 * writes any custom field id that is either undiscovered or carries an
 * unrecognized schema type. Standard (non-`customfield_`-prefixed) keys
 * are never inspected here.
 */
export function assertCustomFieldWritesAreDiscovered(
  fields: Readonly<Record<string, unknown>>,
  index: FieldMetadataIndex,
): void {
  for (const fieldId of Object.keys(fields)) {
    if (!fieldId.startsWith(CUSTOM_FIELD_ID_PREFIX)) continue;

    const metadata = index.get(fieldId);
    if (metadata === undefined) {
      throw ConnectorError.validation({
        message: `custom field "${fieldId}" is not present in discovered field metadata`,
        provider: JIRA_PROVIDER_NAME,
        retryable: false,
      });
    }
    if (!isKnownJiraFieldSchemaType(metadata.schemaType)) {
      throw ConnectorError.validation({
        message: `custom field "${fieldId}" has an unrecognized schema type "${metadata.schemaType}"`,
        provider: JIRA_PROVIDER_NAME,
        retryable: false,
      });
    }
  }
}
