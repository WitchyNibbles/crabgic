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
 * own purity requirement (`@crabgic/gateway`).
 */
export interface GrafanaResourceDefinition extends GrafanaFamilyBehaviour {
  readonly kind: GrafanaResourceKind;
  /**
   * App Platform (`/apis`) behaviour for this kind, when the connector can
   * actually speak it. Absent means "legacy only", and
   * `../discovery/route-table.ts` will then never route this kind to `apis`
   * however loudly the server advertises it.
   *
   * WHY THIS EXISTS. The members of `GrafanaFamilyBehaviour` above are the
   * CLASSIC (`/api`) shapes, and they were, for a long time, the only shapes
   * this package had — while `selectRouteFamily` preferred `apis` whenever a
   * build advertised it. The two facts together meant every write against a
   * Grafana with the App Platform API enabled composed a classic path
   * fragment onto a Kubernetes-style base and posted a classic body to it:
   * `POST /apis/dashboard.grafana.app/v1beta1/namespaces/default/dashboards/db`
   * carrying `{dashboard, folderUid, overwrite}`. Grafana answered with a
   * Kubernetes `Status` object and the mutation failed. Nothing caught it:
   * 11.6 — the only containerized recipe exercised, and now retired as EOL —
   * is legacy-only, and this package's Grafana cassettes are hand-authored
   * rather than recorded, so they encoded the same wrong shape on both
   * sides. The defect surfaced the first time a write ran against a real
   * 12.4 container.
   *
   * The optionality is therefore load-bearing, not convenience: it is what
   * makes "the server offers a family we cannot speak" degrade to the family
   * we can, instead of to garbage on the wire.
   */
  readonly apis?: GrafanaFamilyBehaviour;
}

/**
 * The request-building and parsing surface of ONE route family.
 *
 * Split out of `GrafanaResourceDefinition` so a definition can carry a
 * second, family-specific implementation without duplicating the kind or
 * the family-independent members. `resolveDefinitionForFamily` picks between
 * them, and returns something satisfying `GrafanaResourceDefinition` either
 * way — so every call site keeps its existing signature.
 */
export interface GrafanaFamilyBehaviour {
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
  /**
   * Extracts the revision from a MUTATION response (the immediate
   * create/update reply), when this family does not carry it the classic way.
   *
   * Optional, and absent for the classic family, whose revision is
   * `revisionFromEtagOrField(headers, body.version)` — the fallback
   * `../mutation/mutation-apply-client.ts` applies. The App Platform carries
   * neither an `ETag` nor a `version` field, so that fallback silently
   * produced the literal string `"unknown"` for every apis-routed create:
   * the mutation succeeded, the pipeline reported
   * `appliedRevision: "unknown"`, and the traceability evidence recorded a
   * "confirmed revision" that confirmed nothing. A revision that is not a
   * real revision is worse than a failure, because it looks like success.
   */
  revisionFromMutationResponse?(
    bodyText: string,
    headers: Readonly<Record<string, string>>,
  ): string;
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

/**
 * Picks the behaviour to use for `family`, as something satisfying the whole
 * `GrafanaResourceDefinition` contract.
 *
 * Returning a full definition rather than a bare behaviour is deliberate:
 * every consumer (`../adapter.ts`, `../mutation/mutation-apply-client.ts`,
 * `../mutation/rollback.ts`) already holds a definition and calls builders on
 * it, so family-awareness costs those call sites one changed LOOKUP and no
 * changed signatures.
 *
 * A kind with no `apis` behaviour resolves to its legacy behaviour even when
 * asked for `apis`. That is defence in depth rather than the primary
 * mechanism — `../discovery/route-table.ts` already declines to route such a
 * kind to `apis` — but the two together mean a classic body can never reach
 * a Kubernetes-style endpoint by any path.
 */
export function resolveDefinitionForFamily(
  definition: GrafanaResourceDefinition,
  family: "legacy" | "apis",
): GrafanaResourceDefinition {
  if (family !== "apis" || definition.apis === undefined) return definition;
  return { kind: definition.kind, ...definition.apis };
}

/** Whether this connector can speak the App Platform (`/apis`) family for `definition`'s kind. */
export function supportsApisFamily(definition: GrafanaResourceDefinition): boolean {
  return definition.apis !== undefined;
}
