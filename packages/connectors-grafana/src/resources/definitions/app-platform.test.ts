import { describe, expect, it } from "vitest";
import { dashboardDefinition } from "./dashboard.js";
import { folderDefinition } from "./folder.js";
import { FOLDER_ANNOTATION, appPlatformRevision } from "./app-platform.js";
import {
  resolveDefinitionForFamily,
  supportsApisFamily,
  type GrafanaResourceDefinition,
} from "../resource-definitions.js";
import { alertRuleDefinition } from "./alert-rule.js";

/**
 * App Platform (`/apis`) shapes.
 *
 * EVERY FIXTURE IN THIS FILE IS A REAL RESPONSE from
 * `grafana/grafana-oss:12.4.3`, captured by driving the container directly.
 * That provenance is the point: this package's Grafana cassettes are
 * hand-authored, and for as long as the classic builders were the only
 * builders, they agreed with themselves while disagreeing with every real
 * Grafana that offers the App Platform API. Fixtures invented from
 * documentation would reproduce that failure exactly.
 */

const DASH_BASE = "/apis/dashboard.grafana.app/v1beta1/namespaces/default/dashboards";
const FOLDER_BASE = "/apis/folder.grafana.app/v1beta1/namespaces/default/folders";

/** Real `POST .../dashboards` response body, trimmed to the members the parser reads. */
const REAL_DASHBOARD_RESPONSE = JSON.stringify({
  kind: "Dashboard",
  apiVersion: "dashboard.grafana.app/v1beta1",
  metadata: {
    name: "eo-dash-1",
    namespace: "default",
    resourceVersion: "1785080577718989",
    generation: 1,
    creationTimestamp: "2026-07-26T15:37:24Z",
    annotations: { "grafana.app/createdBy": "user:eftabxpidogsgb" },
  },
  spec: { title: "EO Dash", tags: ["eo"], schemaVersion: 42, panels: [] },
});

const apis = (definition: GrafanaResourceDefinition): GrafanaResourceDefinition =>
  resolveDefinitionForFamily(definition, "apis");

describe("dashboard — App Platform requests", () => {
  it("creates by POSTing the collection with {metadata:{name}, spec}", () => {
    const spec = apis(dashboardDefinition).buildCreateRequest(
      DASH_BASE,
      { title: "EO Dash", tags: ["eo"] },
      "eo-dash-1",
    );
    expect(spec.method).toBe("POST");
    expect(spec.path).toBe(DASH_BASE);
    expect(spec.body).toEqual({
      metadata: { name: "eo-dash-1" },
      spec: { title: "EO Dash", tags: ["eo"] },
    });
  });

  /** The regression this whole module exists for. */
  it("never appends the classic `/db` suffix, nor sends a classic body", () => {
    const spec = apis(dashboardDefinition).buildCreateRequest(DASH_BASE, { title: "x" }, "uid-1");
    expect(spec.path).not.toContain("/db");
    expect(spec.body).not.toHaveProperty("dashboard");
    expect(spec.body).not.toHaveProperty("overwrite");
  });

  it("updates with PUT on the named object, carrying resourceVersion as the precondition", () => {
    const spec = apis(dashboardDefinition).buildUpdateRequest(
      DASH_BASE,
      "eo-dash-1",
      { title: "EO Dash v2" },
      "1785080577718989",
    );
    expect(spec.method).toBe("PUT");
    expect(spec.path).toBe(`${DASH_BASE}/eo-dash-1`);
    expect(spec.hasPrecondition).toBe(true);
    expect(spec.body).toMatchObject({
      metadata: { name: "eo-dash-1", resourceVersion: "1785080577718989" },
    });
  });

  it("carries folder placement as the grafana.app/folder annotation, not a body field", () => {
    const spec = apis(dashboardDefinition).buildCreateRequest(
      DASH_BASE,
      { title: "In Folder", folderUid: "eo-folder-1" },
      "eo-dash-2",
    );
    expect(spec.body).toMatchObject({
      metadata: { annotations: { [FOLDER_ANNOTATION]: "eo-folder-1" } },
    });
    expect(spec.body).not.toHaveProperty("folderUid");
  });

  it("omits the annotation block entirely when no folder was asked for", () => {
    const spec = apis(dashboardDefinition).buildCreateRequest(DASH_BASE, { title: "x" }, "uid-1");
    expect((spec.body as { metadata: Record<string, unknown> }).metadata).not.toHaveProperty(
      "annotations",
    );
  });

  it("reads the revision from metadata.resourceVersion, never spec.version", () => {
    const parsed = apis(dashboardDefinition).parseCanonical(
      "eo-dash-1",
      REAL_DASHBOARD_RESPONSE,
      {},
    );
    expect(parsed.revision).toBe("1785080577718989");
  });

  it("projects only the canonical fields out of the server's fully-defaulted spec", () => {
    const parsed = apis(dashboardDefinition).parseCanonical(
      "eo-dash-1",
      REAL_DASHBOARD_RESPONSE,
      {},
    );
    // The real response carries schemaVersion/panels/templating/etc; none of
    // them are canonical, and comparing on them would make every read-back
    // spuriously mismatch.
    //
    // `folderUid` IS present, as `null`: `pickCanonicalFields` emits every
    // canonical key regardless, so a field's absence hashes the same on both
    // sides of a compare. The classic parser behaves identically, which is
    // what keeps a legacy-written resource comparable to an apis-read one.
    expect(Object.keys(parsed.fields).sort()).toEqual(["folderUid", "tags", "title"]);
    // `folderUid` is `""`, not null: no folder annotation means the ROOT
    // folder, which the classic API also renders as `""`. See the note in
    // `./dashboard.ts` — a `null` here made every root-folder create report
    // "read-back did not confirm the desired state" against a live 12.4.
    expect(parsed.fields).toMatchObject({ title: "EO Dash", tags: ["eo"], folderUid: "" });
  });

  it("round-trips folder placement: what it writes as an annotation, it reads back as folderUid", () => {
    const withFolder = JSON.stringify({
      metadata: {
        name: "eo-dash-2",
        resourceVersion: "42",
        annotations: { [FOLDER_ANNOTATION]: "eo-folder-1" },
      },
      spec: { title: "In Folder" },
    });
    const parsed = apis(dashboardDefinition).parseCanonical("eo-dash-2", withFolder, {});
    expect(parsed.fields).toMatchObject({ title: "In Folder", folderUid: "eo-folder-1" });
  });

  it('renders a root-folder dashboard\'s folderUid as "", matching what the classic family returns', () => {
    const parsed = apis(dashboardDefinition).parseCanonical(
      "eo-dash-1",
      JSON.stringify({
        metadata: { name: "eo-dash-1", resourceVersion: "9" },
        spec: { title: "t" },
      }),
      {},
    );
    expect(parsed.fields.folderUid).toBe("");
    expect(parsed.fields.folderUid).not.toBeNull();
  });

  it("parses a list from {items:[...]}, not a bare array", () => {
    const body = JSON.stringify({
      kind: "DashboardList",
      items: [
        { metadata: { name: "eo-dash-1" }, spec: { title: "EO Dash" } },
        { metadata: { name: "eo-dash-2" }, spec: { title: "In Folder" } },
      ],
    });
    expect(apis(dashboardDefinition).parseList(body)).toEqual([
      { externalId: "eo-dash-1", title: "EO Dash" },
      { externalId: "eo-dash-2", title: "In Folder" },
    ]);
  });

  it("lists by GETting the collection with no classic /search suffix", () => {
    expect(apis(dashboardDefinition).buildListRequest(DASH_BASE)).toEqual({
      method: "GET",
      path: DASH_BASE,
    });
  });

  it("gets by name, with no classic /uid/ segment", () => {
    const spec = apis(dashboardDefinition).buildGetRequest(DASH_BASE, "eo-dash-1");
    expect(spec.path).toBe(`${DASH_BASE}/eo-dash-1`);
    expect(spec.path).not.toContain("/uid/");
  });
});

describe("folder — App Platform requests", () => {
  it("creates with {metadata:{name}, spec:{title}}", () => {
    const spec = apis(folderDefinition).buildCreateRequest(
      FOLDER_BASE,
      { title: "EO Folder" },
      "eo-folder-1",
    );
    expect(spec.body).toEqual({
      metadata: { name: "eo-folder-1" },
      spec: { title: "EO Folder" },
    });
  });

  it("carries parentUid as the same grafana.app/folder annotation", () => {
    const spec = apis(folderDefinition).buildCreateRequest(
      FOLDER_BASE,
      { title: "EO Child", parentUid: "eo-folder-1" },
      "eo-child-1",
    );
    expect(spec.body).toMatchObject({
      metadata: { annotations: { [FOLDER_ANNOTATION]: "eo-folder-1" } },
    });
  });

  it("uses the body resourceVersion as its precondition, not the classic If-Match header", () => {
    const spec = apis(folderDefinition).buildUpdateRequest(
      FOLDER_BASE,
      "eo-child-1",
      { title: "renamed" },
      "1785080723945997",
    );
    expect(spec.hasPrecondition).toBe(true);
    expect(spec.headers).toBeUndefined();
    expect(spec.body).toMatchObject({ metadata: { resourceVersion: "1785080723945997" } });
  });

  it("round-trips parentUid through the annotation", () => {
    const body = JSON.stringify({
      metadata: {
        name: "eo-child-1",
        resourceVersion: "1785080723945997",
        annotations: { [FOLDER_ANNOTATION]: "eo-folder-1" },
      },
      spec: { title: "EO Child" },
    });
    const parsed = apis(folderDefinition).parseCanonical("eo-child-1", body, {});
    expect(parsed.revision).toBe("1785080723945997");
    expect(parsed.fields).toMatchObject({ title: "EO Child", parentUid: "eo-folder-1" });
  });
});

describe("appPlatformRevision — a missing revision is an error, never a default", () => {
  it("reads a string resourceVersion", () => {
    expect(appPlatformRevision({ metadata: { resourceVersion: "42" } })).toBe("42");
  });

  it("accepts a numeric one, normalizing to string", () => {
    expect(appPlatformRevision({ metadata: { resourceVersion: 42 } })).toBe("42");
  });

  /**
   * Substituting `""`/`"0"` would turn an optimistic-concurrency
   * precondition into a blind overwrite — the failure mode the read-back
   * machinery exists to prevent.
   */
  it("throws rather than substituting a placeholder when it is absent", () => {
    expect(() => appPlatformRevision({ metadata: {} })).toThrow(/resourceVersion/);
    expect(() => appPlatformRevision({})).toThrow(/resourceVersion/);
  });

  it("throws on an empty-string revision, which is not a usable precondition", () => {
    expect(() => appPlatformRevision({ metadata: { resourceVersion: "" } })).toThrow();
  });
});

describe("family resolution", () => {
  it("reports which kinds this connector can speak App Platform for", () => {
    expect(supportsApisFamily(dashboardDefinition)).toBe(true);
    expect(supportsApisFamily(folderDefinition)).toBe(true);
    // Alerting kinds are legacy-only in every build fixture, and their
    // App Platform shapes have never been verified against a real server —
    // so the connector does NOT claim to speak them.
    expect(supportsApisFamily(alertRuleDefinition)).toBe(false);
  });

  it("returns the classic behaviour when the legacy family is asked for", () => {
    const legacy = resolveDefinitionForFamily(dashboardDefinition, "legacy");
    expect(legacy.buildCreateRequest("/api/dashboards", { title: "x" }, "uid-1").path).toBe(
      "/api/dashboards/db",
    );
  });

  it("falls back to classic behaviour for a kind with no App Platform support", () => {
    const resolved = resolveDefinitionForFamily(alertRuleDefinition, "apis");
    expect(resolved).toBe(alertRuleDefinition);
  });

  it("keeps the kind intact when specialising", () => {
    expect(apis(dashboardDefinition).kind).toBe("dashboard");
    expect(apis(folderDefinition).kind).toBe("folder");
  });
});

/**
 * The two kinds canonicalise "no parent" DIFFERENTLY, and both were verified
 * against a live `grafana/grafana-oss:12.4.3` rather than assumed:
 *
 * - a top-level folder's classic GET omits `parentUid` entirely → `null`;
 * - a root dashboard's classic `meta.folderUid` is literally `""`.
 *
 * The App Platform expresses both as an absent `grafana.app/folder`
 * annotation, so each kind must map that absence onto its own family-neutral
 * canonical value — otherwise a resource written through one family and read
 * through the other compares unequal, and every root-level create reports
 * "read-back did not confirm the desired state".
 */
describe("no-parent canonicalisation matches the classic family, per kind", () => {
  const noAnnotation = (name: string) =>
    JSON.stringify({ metadata: { name, resourceVersion: "9" }, spec: { title: "t" } });

  it("a root dashboard's folderUid is the empty string", () => {
    expect(
      apis(dashboardDefinition).parseCanonical("d1", noAnnotation("d1"), {}).fields.folderUid,
    ).toBe("");
  });

  it("a top-level folder's parentUid is null, not the empty string", () => {
    const fields = apis(folderDefinition).parseCanonical("f1", noAnnotation("f1"), {}).fields;
    expect(fields.parentUid).toBeNull();
    expect(fields.parentUid).not.toBe("");
  });

  it("each still round-trips a real parent through the shared annotation", () => {
    const withParent = JSON.stringify({
      metadata: {
        name: "x",
        resourceVersion: "9",
        annotations: { [FOLDER_ANNOTATION]: "parent-1" },
      },
      spec: { title: "t" },
    });
    expect(apis(folderDefinition).parseCanonical("x", withParent, {}).fields.parentUid).toBe(
      "parent-1",
    );
    expect(apis(dashboardDefinition).parseCanonical("x", withParent, {}).fields.folderUid).toBe(
      "parent-1",
    );
  });
});

/**
 * The revision the MUTATION reply carries.
 *
 * The classic extractor reads an `ETag` header or a `version` body field;
 * an App Platform reply has neither, so before this member existed every
 * apis-routed create reported `appliedRevision: "unknown"` — a successful
 * mutation whose "confirmed revision" confirmed nothing, which is worse than
 * a failure because it reads as success all the way into the release
 * traceability artifact.
 */
describe("revisionFromMutationResponse", () => {
  it("reads the server-assigned resourceVersion straight off the create reply", () => {
    const extract = apis(dashboardDefinition).revisionFromMutationResponse;
    expect(extract).toBeDefined();
    expect(extract?.(REAL_DASHBOARD_RESPONSE, {})).toBe("1785080577718989");
  });

  it('never degrades to the literal string "unknown"', () => {
    const extract = apis(dashboardDefinition).revisionFromMutationResponse;
    expect(extract?.(REAL_DASHBOARD_RESPONSE, {})).not.toBe("unknown");
  });

  it("throws on a reply with no resourceVersion, rather than inventing one", () => {
    const extract = apis(folderDefinition).revisionFromMutationResponse;
    expect(() => extract?.(JSON.stringify({ metadata: {} }), {})).toThrow(/resourceVersion/);
  });

  it("is absent for the classic family, which keeps the ETag/version extraction", () => {
    expect(dashboardDefinition.revisionFromMutationResponse).toBeUndefined();
    expect(alertRuleDefinition.revisionFromMutationResponse).toBeUndefined();
  });
});
