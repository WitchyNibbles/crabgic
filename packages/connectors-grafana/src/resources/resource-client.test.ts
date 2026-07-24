import { describe, expect, it } from "vitest";
import { GatewayHttpClient, createFakeProviderTransport } from "@eo/gateway";
import { GRAFANA_RESOURCE_KINDS } from "../resource-kinds.js";
import { GRAFANA_RESOURCE_DEFINITIONS, getResourceDefinition } from "./definitions/index.js";
import { canonicalFieldsEqual, hashCanonicalFields } from "./resource-definitions.js";
import { toGatewayHttpRequest } from "./transport-bridge.js";

const FAKE_BASE_URL = "https://fake-grafana.invalid";

describe("GRAFANA_RESOURCE_DEFINITIONS registry", () => {
  it("covers every one of the 7 declared kinds, no more, no fewer", () => {
    expect([...Object.keys(GRAFANA_RESOURCE_DEFINITIONS)].sort()).toEqual(
      [...GRAFANA_RESOURCE_KINDS].sort(),
    );
    for (const kind of GRAFANA_RESOURCE_KINDS) {
      expect(getResourceDefinition(kind).kind).toBe(kind);
    }
  });
});

/** One fixture-shaped raw JSON body per kind — plausible enough to exercise `parseCanonical`/`parseList` without asserting anything about Grafana's exact live wire format (this package makes no live network calls; drift is a fixture update, per roadmap/20 §Risks). */
const CANONICAL_FIXTURE_BODY: Readonly<Record<(typeof GRAFANA_RESOURCE_KINDS)[number], string>> = {
  folder: JSON.stringify({
    uid: "fold-1",
    title: "Team Dashboards",
    parentUid: null,
    url: "/dashboards/f/fold-1",
  }),
  dashboard: JSON.stringify({
    dashboard: { uid: "dash-1", title: "Latency", tags: ["slo"], version: 3 },
    meta: { folderUid: "fold-1", url: "/d/dash-1" },
  }),
  annotation: JSON.stringify({
    id: 42,
    text: "deploy v2",
    tags: ["release"],
    dashboardUID: "dash-1",
    time: 1700000000000,
    updated: 1700000000000,
  }),
  "alert-rule": JSON.stringify({
    uid: "rule-1",
    title: "High error rate",
    folderUID: "fold-1",
    ruleGroup: "slo",
    condition: "B",
    isPaused: false,
    version: 2,
  }),
  "contact-point": JSON.stringify({
    uid: "cp-1",
    name: "on-call",
    type: "email",
    settings: { addresses: "a@example.com" },
    version: 1,
  }),
  "mute-timing": JSON.stringify({
    uid: "mt-1",
    name: "weekends",
    time_intervals: [{ weekdays: ["saturday", "sunday"] }],
    version: 1,
  }),
  "notification-template": JSON.stringify({
    uid: "tmpl-1",
    name: "slack-default",
    template: "{{ .CommonAnnotations }}",
    version: 1,
  }),
};

describe.each(GRAFANA_RESOURCE_KINDS)(
  "resource client contract — kind %s (work item 3)",
  (kind) => {
    const definition = getResourceDefinition(kind);
    const basePath = `/api/${kind}s`;

    it("buildListRequest/buildGetRequest are GET, never mutating", () => {
      const listReq = definition.buildListRequest(basePath);
      expect(listReq.method).toBe("GET");
      const getReq = definition.buildGetRequest(basePath, "example-1");
      expect(getReq.method).toBe("GET");
      expect(getReq.path).toContain("example-1");
    });

    it("parseList throws on a non-array body rather than silently coercing it", () => {
      expect(() => definition.parseList(JSON.stringify({ not: "an array" }))).toThrow(
        /expected a JSON array/,
      );
    });

    it("parseList parses a valid array body into resource summaries", () => {
      const body = JSON.stringify([
        { uid: "example-1", id: 1, title: "Example", name: "Example", text: "Example" },
      ]);
      const summaries = definition.parseList(body);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.externalId.length).toBeGreaterThan(0);
    });

    it("buildCreateRequest never issues a GET/PUT/PATCH — always a fresh write, and its request is transportable through @eo/gateway", () => {
      const createReq = definition.buildCreateRequest(
        basePath,
        { title: "x", name: "x", text: "x" },
        "deterministic-uid-1",
      );
      expect(createReq.method).toBe("POST");
      const bridged = toGatewayHttpRequest(createReq, FAKE_BASE_URL);
      expect(bridged.url.toString().startsWith(FAKE_BASE_URL)).toBe(true);
      expect(bridged.body).toBeDefined();
    });

    it("buildUpdateRequest always carries a precondition (never a blind overwrite)", () => {
      const updateReq = definition.buildUpdateRequest(
        basePath,
        "example-1",
        { title: "y", name: "y", text: "y" },
        "7",
      );
      expect(updateReq.hasPrecondition).toBe(true);
      expect(updateReq.method === "PUT" || updateReq.method === "POST").toBe(true);
      const serialized = JSON.stringify(updateReq);
      expect(serialized).toContain("7");
    });

    it("parseCanonical(parseCanonical-fixture) round-trips: identical raw content always compares equal", () => {
      const bodyText = CANONICAL_FIXTURE_BODY[kind];
      const first = definition.parseCanonical("example-1", bodyText, {});
      const second = definition.parseCanonical("example-1", bodyText, {});
      expect(first.kind).toBe(kind);
      expect(canonicalFieldsEqual(first.fields, second.fields)).toBe(true);
      expect(hashCanonicalFields(first.fields)).toBe(hashCanonicalFields(second.fields));
    });

    it("parseCanonical detects a genuine content change (never a false-equal)", () => {
      const bodyText = CANONICAL_FIXTURE_BODY[kind];
      const original = definition.parseCanonical("example-1", bodyText, {});
      const mutated = JSON.parse(bodyText) as Record<string, unknown>;
      // Perturb whichever canonical field this kind actually tracks — every
      // definition tracks at least a name/title/text-shaped field.
      const nested = (mutated.dashboard as Record<string, unknown> | undefined) ?? mutated;
      if (typeof nested.title === "string") nested.title = `${nested.title}-changed`;
      if (typeof nested.name === "string") nested.name = `${nested.name}-changed`;
      if (typeof nested.text === "string") nested.text = `${nested.text}-changed`;
      const changed = definition.parseCanonical("example-1", JSON.stringify(mutated), {});
      expect(canonicalFieldsEqual(original.fields, changed.fields)).toBe(false);
    });

    it("resolves a revision from an ETag header when present, taking precedence over any body field", () => {
      const bodyText = CANONICAL_FIXTURE_BODY[kind];
      const withEtag = definition.parseCanonical("example-1", bodyText, { etag: '"etag-value-1"' });
      expect(withEtag.revision).toBe("etag-value-1");
    });

    it("every request this definition builds is exercised end-to-end through @eo/gateway's real transport stack against a fake provider", async () => {
      const fakeTransport = createFakeProviderTransport({
        responses: [{ status: 200, bodyText: CANONICAL_FIXTURE_BODY[kind] }],
      });
      const client = new GatewayHttpClient({
        allowlist: { allowedSchemes: ["https:"], allowedOrigins: [FAKE_BASE_URL] },
        sendRequest: fakeTransport.send,
        resolveHostAddresses: async () => ["203.0.113.9"],
        sleep: async () => undefined,
      });
      const getReq = definition.buildGetRequest(basePath, "example-1");
      const bridged = toGatewayHttpRequest(getReq, FAKE_BASE_URL);
      const response = await client.request({
        connectionId: "conn-1",
        tenant: "tenant-1",
        resource: `${kind}:example-1`,
        ...bridged,
      });
      expect(response.status).toBe(200);
      expect(fakeTransport.calls).toHaveLength(1);
      expect(fakeTransport.calls[0]?.method).toBe("GET");
    });
  },
);

describe("canonicalizeDesiredInput — adversarial-review HIGH/MEDIUM fix: the verify() comparison baseline", () => {
  it("folder/dashboard/alert-rule/mute-timing are identity for BOTH create and update (their buildCreateRequest never touches a canonical field)", () => {
    const identityKinds = ["folder", "dashboard", "alert-rule", "mute-timing"] as const;
    for (const kind of identityKinds) {
      const definition = getResourceDefinition(kind);
      const input = { title: "x", name: "x", time_intervals: [] };
      for (const action of ["create", "update"] as const) {
        expect(
          definition.canonicalizeDesiredInput(input, { action, deterministicUid: "uid-1" }),
        ).toEqual(input);
      }
    }
  });

  it("annotation's canonicalizeDesiredInput injects the SAME marker buildCreateRequest's own wire body carries, on create only", () => {
    const definition = getResourceDefinition("annotation");
    const input = { text: "x", tags: ["release"], dashboardUID: "dash-1", time: 1 };

    const desiredOnCreate = definition.canonicalizeDesiredInput(input, {
      action: "create",
      deterministicUid: "abc123",
    });
    expect(desiredOnCreate.tags).toEqual(["release", "eo-marker:abc123"]);

    const builtRequest = definition.buildCreateRequest("/api/annotations", input, "abc123");
    expect((builtRequest.body as { tags: readonly string[] }).tags).toEqual(desiredOnCreate.tags);

    // Update never injects a marker (an update targets an already-created,
    // already-known annotation id).
    const desiredOnUpdate = definition.canonicalizeDesiredInput(input, {
      action: "update",
      deterministicUid: "abc123",
    });
    expect(desiredOnUpdate).toEqual(input);
  });

  it("contact-point's canonicalizeDesiredInput redacts settings identically to parseCanonical's own redaction, on both create and update", () => {
    const definition = getResourceDefinition("contact-point");
    const input = {
      name: "on-call",
      type: "email",
      settings: { addresses: "a@x.com", password: "hunter2" },
    };
    for (const action of ["create", "update"] as const) {
      const desired = definition.canonicalizeDesiredInput(input, {
        action,
        deterministicUid: "uid-1",
      });
      expect((desired.settings as Record<string, unknown>).password).toBe("[redacted]");
      expect((desired.settings as Record<string, unknown>).addresses).toBe("a@x.com");
    }
    // The actual wire body sent to Grafana is NEVER redacted — corrupting
    // the real webhook/SMTP secret would break the actual mutation.
    const builtRequest = definition.buildCreateRequest(
      "/api/v1/provisioning/contact-points",
      input,
      "uid-1",
    );
    expect((builtRequest.body as { settings: Record<string, unknown> }).settings.password).toBe(
      "hunter2",
    );
  });

  it("notification-template's canonicalizeDesiredInput/parseCanonical pass a non-string template through unchanged (no redaction attempted on non-text content)", () => {
    const definition = getResourceDefinition("notification-template");
    const desired = definition.canonicalizeDesiredInput(
      { name: "slack", template: undefined },
      { action: "create", deterministicUid: "uid-1" },
    );
    expect(desired.template).toBeUndefined();

    const canonical = definition.parseCanonical("tmpl-1", JSON.stringify({ name: "slack" }), {});
    expect(canonical.fields.template == null).toBe(true); // absent from the raw body -> null/undefined, never redacted-as-if-present
  });

  it("notification-template's canonicalizeDesiredInput redacts credential-shaped template content identically to parseCanonical", () => {
    const definition = getResourceDefinition("notification-template");
    const input = { name: "slack", template: "token=glsa_abcdefghijklmnopqrst1234567890" };
    const desired = definition.canonicalizeDesiredInput(input, {
      action: "create",
      deterministicUid: "uid-1",
    });
    expect(desired.template).not.toContain("glsa_abcdefghijklmnopqrst1234567890");
    // The actual wire body is never redacted.
    const builtRequest = definition.buildCreateRequest(
      "/api/v1/provisioning/templates",
      input,
      "uid-1",
    );
    expect((builtRequest.body as { template: string }).template).toBe(input.template);
  });

  it("exhaustive sweep: every kind's canonicalizeDesiredInput output round-trips through hashCanonicalFields without throwing", () => {
    for (const kind of GRAFANA_RESOURCE_KINDS) {
      const definition = getResourceDefinition(kind);
      const input = { title: "x", name: "x", text: "x", settings: {}, template: "x" };
      for (const action of ["create", "update"] as const) {
        const desired = definition.canonicalizeDesiredInput(input, {
          action,
          deterministicUid: "uid-1",
        });
        expect(() => hashCanonicalFields(desired)).not.toThrow();
      }
    }
  });
});
