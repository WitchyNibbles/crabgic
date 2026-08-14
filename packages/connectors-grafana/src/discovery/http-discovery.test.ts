import { describe, expect, it } from "vitest";
import {
  ConnectorError,
  CURRENT_SCHEMA_VERSION,
  type ExternalConnection,
} from "@crabgic/contracts";
import type { GatewayHttpClient } from "@crabgic/gateway";
import {
  buildGrafanaDiscoveryDeps,
  buildGrafanaSender,
  normalizeGrafanaEdition,
} from "./http-discovery.js";

const CONNECTION: ExternalConnection = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  provider: "grafana",
  baseUrl: "https://grafana.example.com",
  allowedRedirectOrigins: [],
  allowedResources: ["dashboard"],
  allowedActions: ["list"],
  discoveryTtlSeconds: 900,
  secretRef: { backend: "env", variable: "CRABGIC_TEST_GRAFANA_TOKEN" },
};

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
}

function clientReturning(
  respond: (url: string) => { status: number; bodyText?: string },
  recorded: Recorded[] = [],
): GatewayHttpClient {
  return {
    request: async (req: { url: URL; method: string; headers?: Record<string, string> }) => {
      recorded.push({
        url: req.url.toString(),
        method: req.method,
        headers: req.headers ?? {},
      });
      const { status, bodyText } = respond(req.url.toString());
      return { status, headers: {}, bodyText: bodyText ?? "" };
    },
  } as unknown as GatewayHttpClient;
}

const SETTINGS_OK = JSON.stringify({
  buildInfo: { version: "11.3.0", edition: "Open Source", commit: "abc" },
});

describe("buildGrafanaSender", () => {
  it("attaches the connection's token as a Bearer credential", async () => {
    process.env.CRABGIC_TEST_GRAFANA_TOKEN = "glsa_token";
    try {
      const recorded: Recorded[] = [];
      const { get } = buildGrafanaSender(
        CONNECTION,
        clientReturning(() => ({ status: 200, bodyText: "{}" }), recorded),
      );
      await get("/api/folders");
      expect(recorded[0]?.headers["authorization"]).toBe("Bearer glsa_token");
    } finally {
      delete process.env.CRABGIC_TEST_GRAFANA_TOKEN;
    }
  });

  it("resolves the path against the connection's base URL", async () => {
    process.env.CRABGIC_TEST_GRAFANA_TOKEN = "glsa_token";
    try {
      const recorded: Recorded[] = [];
      const { get } = buildGrafanaSender(
        CONNECTION,
        clientReturning(() => ({ status: 200, bodyText: "{}" }), recorded),
      );
      await get("/api/folders");
      expect(recorded[0]?.url).toBe("https://grafana.example.com/api/folders");
    } finally {
      delete process.env.CRABGIC_TEST_GRAFANA_TOKEN;
    }
  });

  it("resolves the secret fresh per call, so a rotated token is picked up", async () => {
    process.env.CRABGIC_TEST_GRAFANA_TOKEN = "first";
    try {
      const recorded: Recorded[] = [];
      const { get } = buildGrafanaSender(
        CONNECTION,
        clientReturning(() => ({ status: 200, bodyText: "{}" }), recorded),
      );
      await get("/api/folders");
      process.env.CRABGIC_TEST_GRAFANA_TOKEN = "second";
      await get("/api/folders");
      expect(recorded.map((r) => r.headers["authorization"])).toEqual([
        "Bearer first",
        "Bearer second",
      ]);
    } finally {
      delete process.env.CRABGIC_TEST_GRAFANA_TOKEN;
    }
  });

  it("`get` is GET-only — it is handed to the apply client's read-back path", async () => {
    process.env.CRABGIC_TEST_GRAFANA_TOKEN = "t";
    try {
      const recorded: Recorded[] = [];
      const { get } = buildGrafanaSender(
        CONNECTION,
        clientReturning(() => ({ status: 200, bodyText: "{}" }), recorded),
      );
      await get("/api/folders");
      expect(recorded[0]?.method).toBe("GET");
    } finally {
      delete process.env.CRABGIC_TEST_GRAFANA_TOKEN;
    }
  });

  it("`send` carries the method it is given", async () => {
    process.env.CRABGIC_TEST_GRAFANA_TOKEN = "t";
    try {
      const recorded: Recorded[] = [];
      const { send } = buildGrafanaSender(
        CONNECTION,
        clientReturning(() => ({ status: 200, bodyText: "{}" }), recorded),
      );
      await send({ method: "GET", path: "/api/search" });
      expect(recorded[0]?.method).toBe("GET");
    } finally {
      delete process.env.CRABGIC_TEST_GRAFANA_TOKEN;
    }
  });
});

/**
 * The edition mapping is the UNVERIFIED half of this module — see
 * `./http-discovery.ts`'s own header. `GrafanaBuildInfoResponseSchema`
 * has a 3-member enum and Grafana reports a display string, so the two
 * have to be reconciled somewhere; doing it in one named, tested function
 * keeps the guess in a single place a live run can correct.
 */
describe("normalizeGrafanaEdition", () => {
  it.each([
    ["Open Source", "oss"],
    ["open source", "oss"],
    ["oss", "oss"],
    ["Enterprise", "enterprise"],
    ["enterprise", "enterprise"],
    ["Cloud", "cloud"],
  ])("maps %s to %s", (raw, expected) => {
    expect(normalizeGrafanaEdition(raw)).toBe(expected);
  });

  it("returns undefined for an edition it does not recognize, rather than guessing", () => {
    // Guessing "oss" would silently grant the write eligibility a known
    // build earns; the caller turns this into a discovery failure.
    expect(normalizeGrafanaEdition("Superscalar")).toBeUndefined();
  });
});

describe("buildGrafanaDiscoveryDeps — fetchBuildInfo", () => {
  it("reads the product, edition and version off the settings endpoint", async () => {
    const { fetchBuildInfo } = buildGrafanaDiscoveryDeps(async () => ({
      status: 200,
      headers: {},
      bodyText: SETTINGS_OK,
    }));
    expect(await fetchBuildInfo()).toEqual({
      product: "grafana",
      edition: "oss",
      version: "11.3.0",
    });
  });

  it("fails with a canonical authentication error on 401, never an empty capability set", async () => {
    // The dangerous alternative: treating a bad credential as "this
    // Grafana supports nothing", which reads as a capability fact and
    // would be cached as one.
    const { fetchBuildInfo } = buildGrafanaDiscoveryDeps(async () => ({
      status: 401,
      headers: {},
      bodyText: "",
    }));
    await expect(fetchBuildInfo()).rejects.toThrow(ConnectorError);
    await expect(fetchBuildInfo()).rejects.toMatchObject({ kind: "authentication" });
  });

  it("fails informatively when the body is not JSON", async () => {
    const { fetchBuildInfo } = buildGrafanaDiscoveryDeps(async () => ({
      status: 200,
      headers: {},
      bodyText: "<html>a proxy login page</html>",
    }));
    await expect(fetchBuildInfo()).rejects.toThrow(ConnectorError);
  });

  it("fails when the response carries no buildInfo, rather than inventing a version", async () => {
    const { fetchBuildInfo } = buildGrafanaDiscoveryDeps(async () => ({
      status: 200,
      headers: {},
      bodyText: JSON.stringify({ notBuildInfo: true }),
    }));
    await expect(fetchBuildInfo()).rejects.toThrow(/buildInfo/);
  });

  it("fails on an unrecognized edition, naming it, so a live run can correct the mapping", async () => {
    const { fetchBuildInfo } = buildGrafanaDiscoveryDeps(async () => ({
      status: 200,
      headers: {},
      bodyText: JSON.stringify({ buildInfo: { version: "11.3.0", edition: "Superscalar" } }),
    }));
    await expect(fetchBuildInfo()).rejects.toThrow(/Superscalar/);
  });
});

describe("buildGrafanaDiscoveryDeps — probeRoute", () => {
  async function probeWith(status: number): Promise<boolean> {
    const { probeRoute } = buildGrafanaDiscoveryDeps(async () => ({
      status,
      headers: {},
      bodyText: "",
    }));
    return probeRoute("dashboard", "legacy");
  }

  it("probes the candidate base path the route table itself would use", async () => {
    const seen: string[] = [];
    const { probeRoute } = buildGrafanaDiscoveryDeps(async (spec) => {
      seen.push(spec.path);
      return { status: 200, headers: {}, bodyText: "" };
    });
    await probeRoute("dashboard", "legacy");
    await probeRoute("folder", "apis");
    expect(seen).toEqual([
      "/api/dashboards",
      "/apis/folder.grafana.app/v1beta1/namespaces/default/folders",
    ]);
  });

  it.each([200, 400, 405])("treats HTTP %i as available — the route exists", async (status) => {
    expect(await probeWith(status)).toBe(true);
  });

  it.each([404, 501])("treats HTTP %i as unavailable — this build has no such route", async (s) => {
    expect(await probeWith(s)).toBe(false);
  });

  it("treats a 403 as unavailable — a route this credential may not use is not a capability", async () => {
    expect(await probeWith(403)).toBe(false);
  });

  it("treats a 5xx as unavailable rather than claiming a capability it could not confirm", async () => {
    expect(await probeWith(503)).toBe(false);
  });

  it("propagates a 401 instead of reporting every route unavailable", async () => {
    // Same reasoning as fetchBuildInfo: a bad credential must not be
    // recorded as a capability fact about the remote.
    const { probeRoute } = buildGrafanaDiscoveryDeps(async () => ({
      status: 401,
      headers: {},
      bodyText: "",
    }));
    await expect(probeRoute("dashboard", "legacy")).rejects.toMatchObject({
      kind: "authentication",
    });
  });

  it("never issues a mutating request while probing", async () => {
    const methods: string[] = [];
    const { probeRoute } = buildGrafanaDiscoveryDeps(async (spec) => {
      methods.push(spec.method);
      return { status: 200, headers: {}, bodyText: "" };
    });
    await probeRoute("alert-rule", "legacy");
    expect(methods).toEqual(["GET"]);
  });
});
