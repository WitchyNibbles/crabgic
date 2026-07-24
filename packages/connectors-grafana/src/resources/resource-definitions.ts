import { createHash } from "node:crypto";
import type { GrafanaResourceKind } from "../resource-kinds.js";

/** A Grafana-facing HTTP request, pre-resolution against a base URL (`../transport-bridge.js` turns this into the gateway's `MutationHttpRequestSpec`/`GatewayHttpRequest` shape). Never `"DELETE"` — no resource definition in this package ever builds one. */
export interface GrafanaHttpRequestSpec {
  readonly method: "GET" | "PUT" | "PATCH" | "POST";
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly hasPrecondition?: boolean;
}

export interface GrafanaResourceSummary {
  readonly externalId: string;
  readonly title?: string;
}

/** The canonical, read-back-comparable form of one Grafana resource — roadmap/20 §Interfaces produced: "Canonical read-back-compare results." `fields` excludes the revision/precondition token itself (that is carried separately as `revision`) and any provider-side volatile noise (server-generated timestamps not under this connector's control). */
export interface GrafanaParsedResource {
  readonly kind: GrafanaResourceKind;
  readonly externalId: string;
  readonly revision: string;
  readonly canonicalUrl?: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** Deterministic content hash over a canonical resource's `fields` — used both as `RemoteMutationPlan.desiredStateHash` and by the fetch-compare-rebase precondition logic (`../mutation/precondition.ts`) to detect "nothing actually changed since our baseline." */
export function hashCanonicalFields(fields: Readonly<Record<string, unknown>>): string {
  const sortedKeys = Object.keys(fields).sort();
  const normalized = sortedKeys.map((key) => [key, fields[key]]);
  return `sha256:${createHash("sha256").update(JSON.stringify(normalized)).digest("hex")}`;
}

/** True iff two canonical resources' `fields` are deep-equal after normalization — the round-trip compare roadmap/20's test plan names ("canonical-serializer round-trip (mutate → read-back → compare)"). */
export function canonicalFieldsEqual(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  return hashCanonicalFields(a) === hashCanonicalFields(b);
}

/**
 * One resource kind's request-building + canonical-serialization contract.
 * Pure — no I/O of its own; every method is deterministic given its
 * inputs, matching `MutationApplyClient.buildRequest`/`parseResponse`'s
 * own purity requirement (`@eo/gateway`).
 */
export interface GrafanaResourceDefinition {
  readonly kind: GrafanaResourceKind;
  buildListRequest(basePath: string): GrafanaHttpRequestSpec;
  buildGetRequest(basePath: string, externalId: string): GrafanaHttpRequestSpec;
  buildCreateRequest(
    basePath: string,
    input: Readonly<Record<string, unknown>>,
    deterministicUid: string,
  ): GrafanaHttpRequestSpec;
  buildUpdateRequest(
    basePath: string,
    externalId: string,
    input: Readonly<Record<string, unknown>>,
    expectedRevision: string,
  ): GrafanaHttpRequestSpec;
  parseList(bodyText: string): readonly GrafanaResourceSummary[];
  /** The canonical serializer — the SAME function used for the immediate parse-response step and for a later independent read-back GET, so "mutate → read-back → compare" always compares apples to apples. */
  parseCanonical(
    externalId: string,
    bodyText: string,
    headers: Readonly<Record<string, string>>,
  ): GrafanaParsedResource;
  /**
   * Adversarial-review HIGH/MEDIUM fix: transforms a caller-supplied
   * create/update `input` into the fields the remote resource will
   * ACTUALLY reflect once the corresponding request lands — the
   * comparison baseline `../mutation/mutation-apply-client.ts`'s
   * `verify()`/`reconcileAmbiguous()` hash against, NEVER the raw `input`
   * directly. Covers two kinds of connector-side transformation a
   * `build{Create,Update}Request` implementation may itself perform on a
   * CANONICAL field:
   *
   *  - a create-time marker injected into a canonical field (annotation's
   *    `tags` — Grafana assigns no caller id for annotations, so the
   *    dedup marker rides inside a field `parseCanonical` also reads);
   *  - defense-in-depth secret redaction (contact-point `settings`,
   *    notification-template `template`) — the SAME redaction
   *    `parseCanonical` applies to the remote read-back, so a comparison
   *    never spuriously mismatches on a value that is redacted on only
   *    one side.
   *
   * Never applied to the actual outbound wire body — `buildCreateRequest`/
   * `buildUpdateRequest` always send the caller's REAL input (a redacted
   * webhook URL sent to Grafana would corrupt the actual contact point).
   * Defaults to the identity function for every kind needing neither
   * transformation (folder, dashboard, alert-rule, mute-timing).
   */
  canonicalizeDesiredInput(
    input: Readonly<Record<string, unknown>>,
    context: { readonly action: "create" | "update"; readonly deterministicUid: string },
  ): Readonly<Record<string, unknown>>;
}
