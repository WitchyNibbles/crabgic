/** Extracts a revision token: prefers the response's `ETag` header (case-insensitive, quotes stripped); falls back to a body field (e.g. `version`) when no ETag is present. Every resource definition uses this so "resourceVersion/ETag/dashboard-version" (roadmap/20 §In scope) resolves through one shared, tested code path. */
export function revisionFromEtagOrField(
  headers: Readonly<Record<string, string>>,
  fallback: string | number | undefined,
): string {
  const etagKey = Object.keys(headers).find((key) => key.toLowerCase() === "etag");
  const etag = etagKey !== undefined ? headers[etagKey] : undefined;
  if (etag !== undefined && etag.length > 0) {
    return etag.replaceAll('"', "");
  }
  if (fallback !== undefined) {
    return String(fallback);
  }
  return "unknown";
}

import type { GrafanaResourceSummary } from "../resource-definitions.js";

/** Builds a `GrafanaResourceSummary`, respecting `exactOptionalPropertyTypes` — `title` is omitted entirely (never set to `undefined`) when the raw value isn't a string. */
export function buildResourceSummary(externalId: string, title: unknown): GrafanaResourceSummary {
  return typeof title === "string" ? { externalId, title } : { externalId };
}

export function parseJsonBody(bodyText: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(bodyText.length > 0 ? bodyText : "{}");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected a JSON object body");
  }
  return parsed as Record<string, unknown>;
}

/** Picks a fixed, ordered field set off a raw parsed body into a canonical `fields` record — omitted keys become `null` rather than being dropped, so a field that disappears from a response is a visible content change, not a silent no-op. */
export function pickCanonicalFields(
  raw: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of keys) {
    fields[key] = key in raw ? raw[key] : null;
  }
  return fields;
}
