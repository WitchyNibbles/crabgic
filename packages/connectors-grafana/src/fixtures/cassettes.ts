import type { FakeProviderScriptEntry } from "@eo/gateway";
import type { GrafanaResourceKind } from "../resource-kinds.js";
import { deriveAnnotationMarkerTag } from "../reconciliation/marker-reconciler.js";

/**
 * Recorded per-kind create+verify cassette entries — roadmap/20-grafana-
 * adapters.md work item 6: "per-version cassettes." One (POST-create,
 * GET-verify) response pair per resource kind, ordered exactly as the
 * roadmap's own integration-suite chain: "folder→dashboard→annotation→
 * alert-rule→contact-point→mute-timing→notification-template."
 *
 * The response CONTENT here is provider-agnostic fixture data (never a
 * live-captured recording — this repo's ground rules forbid live network
 * calls in tests); what genuinely varies "per version" is the ROUTE TABLE
 * each build-info fixture resolves (`../discovery/route-table.js`), which
 * `./integration-cassette-replay.test.ts` drives independently per pinned
 * version — this cassette is deliberately reused unchanged across every
 * version replay to prove the SAME 7-kind flow completes regardless of
 * which route family (`/api` vs `/apis`) was selected.
 */
export const RESOURCE_FLOW_ORDER: readonly GrafanaResourceKind[] = [
  "folder",
  "dashboard",
  "annotation",
  "alert-rule",
  "contact-point",
  "mute-timing",
  "notification-template",
];

const CREATE_RESPONSE_BY_KIND: Readonly<Record<GrafanaResourceKind, FakeProviderScriptEntry>> = {
  folder: { status: 200, bodyText: JSON.stringify({ uid: "cassette-folder-1", version: 1 }) },
  dashboard: { status: 200, bodyText: JSON.stringify({ uid: "cassette-dash-1", version: 1 }) },
  annotation: { status: 200, bodyText: JSON.stringify({ id: 5001 }) },
  "alert-rule": { status: 200, bodyText: JSON.stringify({ uid: "cassette-rule-1", version: 1 }) },
  "contact-point": { status: 200, bodyText: JSON.stringify({ uid: "cassette-cp-1", version: 1 }) },
  "mute-timing": { status: 200, bodyText: JSON.stringify({ uid: "cassette-mt-1", version: 1 }) },
  "notification-template": {
    status: 200,
    bodyText: JSON.stringify({ uid: "cassette-tmpl-1", version: 1 }),
  },
};

/** Every kind EXCEPT `annotation` — its verify response must embed this replay's own deterministic marker tag (adversarial-review HIGH fix), so it is built dynamically by `buildAnnotationVerifyResponse` instead of appearing here as static data. */
type NonAnnotationKind = Exclude<GrafanaResourceKind, "annotation">;

const VERIFY_RESPONSE_BY_NON_ANNOTATION_KIND: Readonly<
  Record<NonAnnotationKind, FakeProviderScriptEntry>
> = {
  folder: {
    status: 200,
    bodyText: JSON.stringify({ title: "Cassette Folder", parentUid: null }),
    headers: { etag: '"etag-folder-1"' },
  },
  dashboard: {
    status: 200,
    bodyText: JSON.stringify({
      dashboard: { title: "Cassette Dashboard", tags: ["cassette"], version: 1 },
      meta: { folderUid: "cassette-folder-1" },
    }),
  },
  "alert-rule": {
    status: 200,
    bodyText: JSON.stringify({
      title: "Cassette Rule",
      folderUID: "cassette-folder-1",
      ruleGroup: "cassette",
      condition: "B",
      isPaused: false,
    }),
    headers: { etag: '"etag-rule-1"' },
  },
  "contact-point": {
    status: 200,
    bodyText: JSON.stringify({
      name: "cassette-contact",
      type: "email",
      settings: { addresses: "a@example.com" },
    }),
    headers: { etag: '"etag-cp-1"' },
  },
  "mute-timing": {
    status: 200,
    bodyText: JSON.stringify({ name: "cassette-mute", time_intervals: [] }),
    headers: { etag: '"etag-mt-1"' },
  },
  "notification-template": {
    status: 200,
    bodyText: JSON.stringify({ name: "cassette-template", template: "{{ .CommonAnnotations }}" }),
    headers: { etag: '"etag-tmpl-1"' },
  },
};

export const CREATE_INPUT_BY_KIND: Readonly<
  Record<GrafanaResourceKind, Readonly<Record<string, unknown>>>
> = {
  folder: { title: "Cassette Folder", parentUid: null },
  dashboard: { title: "Cassette Dashboard", tags: ["cassette"], folderUid: "cassette-folder-1" },
  annotation: { text: "cassette deploy", tags: [], dashboardUID: "cassette-dash-1", time: 1 },
  "alert-rule": {
    title: "Cassette Rule",
    folderUID: "cassette-folder-1",
    ruleGroup: "cassette",
    condition: "B",
    isPaused: false,
  },
  "contact-point": {
    name: "cassette-contact",
    type: "email",
    settings: { addresses: "a@example.com" },
  },
  "mute-timing": { name: "cassette-mute", time_intervals: [] },
  "notification-template": { name: "cassette-template", template: "{{ .CommonAnnotations }}" },
};

/** Default idempotency key for callers that only need SOME internally-consistent annotation cassette (e.g. a standalone unit test) and don't care about matching a specific replay's own key — `./integration-cassette-replay.test.ts` instead passes its OWN per-replay idempotency key, so the marker embedded in the returned verify response always matches the marker THAT replay's own `planCreate` call will derive. */
export const DEFAULT_ANNOTATION_IDEMPOTENCY_KEY = "cassette-default:annotation:create";

/**
 * Builds the annotation verify response dynamically — adversarial-review
 * HIGH fix: annotation's `buildCreateRequest` (`../resources/definitions/
 * annotation.ts`) always injects a `eo-marker:<deterministic-uid>` tag
 * derived from the plan's OWN `idempotencyKey`; a static fixture response
 * (as every other kind uses) cannot embed that marker correctly across
 * more than one replay (each replay derives a different marker from its
 * own idempotency key). This function derives the SAME marker
 * `annotationDefinition.canonicalizeDesiredInput`/`buildCreateRequest`
 * would, so the cassette is never inconsistent with the POST body the
 * connector actually sends.
 */
export function buildAnnotationVerifyResponse(
  idempotencyKey: string = DEFAULT_ANNOTATION_IDEMPOTENCY_KEY,
): FakeProviderScriptEntry {
  return {
    status: 200,
    bodyText: JSON.stringify({
      text: "cassette deploy",
      tags: [deriveAnnotationMarkerTag(idempotencyKey)],
      dashboardUID: "cassette-dash-1",
      time: 1,
    }),
    headers: { etag: '"etag-annotation-1"' },
  };
}

export interface BuildKindCreateCassetteOptions {
  /** `annotation` only — the idempotency key THIS replay's `planCreate` call will use, so the returned verify response's embedded marker tag matches exactly (adversarial-review HIGH fix). Ignored for every other kind. */
  readonly annotationIdempotencyKey?: string;
}

/** Builds the flat (create, verify) response sequence for one kind, in the exact order `@eo/gateway`'s pipeline issues them (mutating call first, read-back verify second). */
export function buildKindCreateCassette(
  kind: GrafanaResourceKind,
  options: BuildKindCreateCassetteOptions = {},
): readonly FakeProviderScriptEntry[] {
  if (kind === "annotation") {
    return [
      CREATE_RESPONSE_BY_KIND.annotation,
      buildAnnotationVerifyResponse(options.annotationIdempotencyKey),
    ];
  }
  return [CREATE_RESPONSE_BY_KIND[kind], VERIFY_RESPONSE_BY_NON_ANNOTATION_KIND[kind]];
}
