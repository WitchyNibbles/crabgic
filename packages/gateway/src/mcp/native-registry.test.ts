import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { ConnectorError, type ExternalConnection } from "@eo/contracts";
import { InMemoryExternalConnectionStore } from "../connection-store/external-connection-store.js";
import { ProviderRegistry } from "../provider-dispatch/provider-registry.js";
import { buildNativeToolRegistry } from "./native-registry.js";
import type { GenericProviderClient } from "./native-tools/provider-dispatch-tool.js";
import type { MutationApplyClient } from "./native-tools/mutation-apply-client.js";
import { GatewayHttpClient } from "../transport/http-client.js";

const EXPECTED_NATIVE_TOOL_NAMES = [
  "tracker.search",
  "tracker.get",
  "tracker.plan_create",
  "tracker.plan_update",
  "tracker.plan_transition",
  "tracker.plan_comment",
  "tracker.apply",
  "observability.search",
  "observability.get",
  "observability.query",
  "observability.plan_create",
  "observability.plan_update",
  "observability.apply",
  "evidence.attach",
  "evidence.get",
  "result.submit",
  "run.status",
  "run.cancel",
];

let journalDir: string;
let journal: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-gateway-native-registry-"));
  journal = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("buildNativeToolRegistry", () => {
  it("registers exactly the 18 native tool names across the 8-family surface", () => {
    const registry = buildNativeToolRegistry({
      connections: new InMemoryExternalConnectionStore(),
      providers: new ProviderRegistry<GenericProviderClient>(),
      journal,
      mutationApplyClients: new ProviderRegistry<MutationApplyClient>(),
      supervisorSocketPath: "/nonexistent.sock",
    });

    expect([...registry.toolNames].sort()).toEqual([...EXPECTED_NATIVE_TOOL_NAMES].sort());
  });

  it("never registers a change_set.* or learning.* tool name", () => {
    const registry = buildNativeToolRegistry({
      connections: new InMemoryExternalConnectionStore(),
      providers: new ProviderRegistry<GenericProviderClient>(),
      journal,
      mutationApplyClients: new ProviderRegistry<MutationApplyClient>(),
      supervisorSocketPath: "/nonexistent.sock",
    });

    for (const name of registry.toolNames) {
      expect(name.startsWith("change_set.")).toBe(false);
      expect(name.startsWith("learning.")).toBe(false);
    }
  });

  it("dispatches tracker.search end-to-end to a registered fake provider client", async () => {
    const connections = new InMemoryExternalConnectionStore();
    const providers = new ProviderRegistry<GenericProviderClient>();
    const connection: ExternalConnection = await connections.create({
      provider: "fake-tracker",
      baseUrl: "https://example.invalid",
      allowedRedirectOrigins: [],
      allowedResources: ["issue"],
      allowedActions: ["read"],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "EO_GATEWAY_NATIVE_REGISTRY_TEST_SECRET" },
    });

    providers.register("fake-tracker", {
      search: async (params) => ({ items: [{ id: "ISSUE-1" }], echo: params }),
    });

    const registry = buildNativeToolRegistry({
      connections,
      providers,
      journal,
      mutationApplyClients: new ProviderRegistry<MutationApplyClient>(),
      supervisorSocketPath: "/nonexistent.sock",
    });

    const tool = registry.get("tracker.search");
    const result = await tool?.handler({ connectionId: connection.id, params: { query: "foo" } });
    expect(result?.isError).toBeFalsy();
    const parsed = JSON.parse(result?.content[0]?.text ?? "{}") as { items: unknown[] };
    expect(parsed.items).toEqual([{ id: "ISSUE-1" }]);
  });

  it("evidence.attach then evidence.get round-trips a submitted record", async () => {
    const registry = buildNativeToolRegistry({
      connections: new InMemoryExternalConnectionStore(),
      providers: new ProviderRegistry<GenericProviderClient>(),
      journal,
      mutationApplyClients: new ProviderRegistry<MutationApplyClient>(),
      supervisorSocketPath: "/nonexistent.sock",
    });

    const changeSetId = "77777777-7777-4777-8777-777777777777";
    const attach = registry.get("evidence.attach");
    await attach?.handler({
      changeSetId,
      command: "npm test",
      exitStatus: 0,
      toolchainFingerprint: "node-24",
      artifactDigests: ["sha256:abc"],
      objectId: "deadbeef",
    });

    const get = registry.get("evidence.get");
    const result = await get?.handler({ changeSetId });
    const parsed = JSON.parse(result?.content[0]?.text ?? "{}") as {
      records: ReadonlyArray<{ changeSetId: string }>;
    };
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]?.changeSetId).toBe(changeSetId);
  });

  it("result.submit durably journals a worker result reference", async () => {
    const registry = buildNativeToolRegistry({
      connections: new InMemoryExternalConnectionStore(),
      providers: new ProviderRegistry<GenericProviderClient>(),
      journal,
      mutationApplyClients: new ProviderRegistry<MutationApplyClient>(),
      supervisorSocketPath: "/nonexistent.sock",
    });

    const submit = registry.get("result.submit");
    const result = await submit?.handler({
      changeSetId: "88888888-8888-4888-8888-888888888888",
      workUnitId: "99999999-9999-4999-8999-999999999999",
      command: "npm run build",
      exitStatus: 0,
      toolchainFingerprint: "node-24",
      artifactDigests: ["sha256:def"],
      objectId: "cafebabe",
    });

    const parsed = JSON.parse(result?.content[0]?.text ?? "{}") as { submitted: boolean };
    expect(parsed.submitted).toBe(true);

    let count = 0;
    for await (const entry of journal.queryEntries({ type: "evidence_pointer" })) {
      if (entry.type === "evidence_pointer" && entry.payload.gateTag === "result.submit") count += 1;
    }
    expect(count).toBe(1);
  });

  it("tracker.search returns a not_found-mapped error for an unknown connectionId", async () => {
    const registry = buildNativeToolRegistry({
      connections: new InMemoryExternalConnectionStore(),
      providers: new ProviderRegistry<GenericProviderClient>(),
      journal,
      mutationApplyClients: new ProviderRegistry<MutationApplyClient>(),
      supervisorSocketPath: "/nonexistent.sock",
    });
    const tool = registry.get("tracker.search");
    const result = await tool?.handler({
      connectionId: "00000000-0000-4000-8000-000000000000",
      params: {},
    });
    expect(result?.isError).toBe(true);
  });

  it("tracker.search returns an unsupported-mapped error for an unregistered provider", async () => {
    const connections = new InMemoryExternalConnectionStore();
    const connection = await connections.create({
      provider: "no-such-provider",
      baseUrl: "https://example.invalid",
      allowedRedirectOrigins: [],
      allowedResources: [],
      allowedActions: [],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "X" },
    });
    const registry = buildNativeToolRegistry({
      connections,
      providers: new ProviderRegistry<GenericProviderClient>(),
      journal,
      mutationApplyClients: new ProviderRegistry<MutationApplyClient>(),
      supervisorSocketPath: "/nonexistent.sock",
    });
    const tool = registry.get("tracker.search");
    const result = await tool?.handler({ connectionId: connection.id, params: {} });
    expect(result?.isError).toBe(true);
  });

  it("tracker.plan_create returns unsupported when the provider client lacks that operation", async () => {
    const connections = new InMemoryExternalConnectionStore();
    const providers = new ProviderRegistry<GenericProviderClient>();
    const connection = await connections.create({
      provider: "partial-provider",
      baseUrl: "https://example.invalid",
      allowedRedirectOrigins: [],
      allowedResources: [],
      allowedActions: [],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "X" },
    });
    providers.register("partial-provider", { search: async () => ({}) }); // no planCreate

    const registry = buildNativeToolRegistry({
      connections,
      providers,
      journal,
      mutationApplyClients: new ProviderRegistry<MutationApplyClient>(),
      supervisorSocketPath: "/nonexistent.sock",
    });
    const tool = registry.get("tracker.plan_create");
    const result = await tool?.handler({ connectionId: connection.id, params: {} });
    expect(result?.isError).toBe(true);
  });

  it("tracker.search maps a thrown provider error to a redacted result, never leaking raw fields", async () => {
    const connections = new InMemoryExternalConnectionStore();
    const providers = new ProviderRegistry<GenericProviderClient>();
    const connection = await connections.create({
      provider: "throwing-provider",
      baseUrl: "https://example.invalid",
      allowedRedirectOrigins: [],
      allowedResources: [],
      allowedActions: [],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "X" },
    });
    providers.register("throwing-provider", {
      // A realistic provider client maps its own raw HTTP failure through
      // `mapHttpStatusToConnectorError` (../mutation-pipeline/error-
      // mapping.js) before ever throwing — `rawProviderResponse` is
      // accepted for redaction derivation only, never stored on the
      // resulting `ConnectorError` (see that module's own leak-hunt test).
      search: async () => {
        throw ConnectorError.authentication({
          message: "authentication failed",
          provider: "throwing-provider",
          retryable: false,
          rawProviderResponse: { apiToken: "raw-upstream-secret-XYZ123" },
        });
      },
    });

    const registry = buildNativeToolRegistry({
      connections,
      providers,
      journal,
      mutationApplyClients: new ProviderRegistry<MutationApplyClient>(),
      supervisorSocketPath: "/nonexistent.sock",
    });
    const tool = registry.get("tracker.search");
    const result = await tool?.handler({ connectionId: connection.id, params: {} });
    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).not.toContain("XYZ123");
  });

  it("tracker.search reports a typed truncation error when the result exceeds the budget, never silently dropping items", async () => {
    const connections = new InMemoryExternalConnectionStore();
    const providers = new ProviderRegistry<GenericProviderClient>();
    const connection = await connections.create({
      provider: "huge-provider",
      baseUrl: "https://example.invalid",
      allowedRedirectOrigins: [],
      allowedResources: [],
      allowedActions: [],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "X" },
    });
    providers.register("huge-provider", {
      search: async () => ({ blob: "x".repeat(300 * 1024) }),
    });

    const registry = buildNativeToolRegistry({
      connections,
      providers,
      journal,
      mutationApplyClients: new ProviderRegistry<MutationApplyClient>(),
      supervisorSocketPath: "/nonexistent.sock",
    });
    const tool = registry.get("tracker.search");
    const result = await tool?.handler({ connectionId: connection.id, params: {} });
    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain("validation");
  });
});

describe("HIGH #2 adversarial-review fix — tracker.apply/observability.apply route through the exactly-once, SSRF-hardened mutation pipeline", () => {
  /**
   * Test-only `buildHttpClient` override: a fake, always-public
   * `resolveHostAddresses` (so DNS-resolution failure of a `.invalid`
   * fixture hostname never masks what's actually under test — the SSRF
   * guard's ORIGIN-allowlist check, or the journal-before-I/O ordering)
   * plus the connection's own true origin allowlisted, matching how
   * `buildHttpClientForConnection` derives its allowlist in production.
   */
  function fakeBuildHttpClient(allowedOrigin: string) {
    return async () =>
      new GatewayHttpClient({
        allowlist: { allowedSchemes: ["https:"], allowedOrigins: [allowedOrigin] },
        resolveHostAddresses: async () => ["203.0.113.7"],
        // No real disposable server exists at this fake address — a
        // request that reaches this far (i.e. survived the SSRF preflight)
        // is answered synthetically, so these tests never depend on real
        // network I/O succeeding or timing out.
        sendRequest: async () => ({ status: 200, headers: {}, bodyText: '{"appliedRevision":"rev-from-fake-transport"}' }),
      });
  }

  function buildValidPlan(overrides: Partial<Record<string, unknown>> = {}, connectionId: string) {
    return {
      schemaVersion: 1,
      id: "d0000000-0000-4000-8000-000000000001",
      externalConnectionId: connectionId,
      tenant: "tenant-a",
      canonicalTarget: "issue:EX-1",
      action: "transition",
      redactedDiff: "status: To Do -> In Progress",
      desiredStateHash: "sha256:apply-tool-test-hash",
      idempotencyKey: "apply-tool-test-op",
      impactClass: "reversible",
      rollbackClass: "version-checked-restore",
      envelopeId: "e0000000-0000-4000-8000-000000000002",
      ...overrides,
    };
  }

  it("tracker.apply persists a pre-I/O pending record before performing the network call (journal-before-I/O)", async () => {
    const connections = new InMemoryExternalConnectionStore();
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    const connection = await connections.create({
      provider: "apply-test-provider",
      baseUrl: "https://apply-test-provider.invalid",
      allowedRedirectOrigins: [],
      allowedResources: ["issue"],
      allowedActions: ["write"],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "EO_GATEWAY_APPLY_TOOL_TEST_SECRET" },
    });

    mutationApplyClients.register("apply-test-provider", {
      buildRequest: () => ({
        url: new URL("https://apply-test-provider.invalid/apply"),
        method: "PUT",
        hasPrecondition: true,
      }),
      parseResponse: () => ({ appliedRevision: "rev-1" }),
    });

    const registry = buildNativeToolRegistry({
      connections,
      providers,
      mutationApplyClients,
      journal,
      supervisorSocketPath: "/nonexistent.sock",
      buildHttpClient: fakeBuildHttpClient("https://apply-test-provider.invalid"),
    });

    // Wrap buildRequest AFTER registry construction is not possible (it's
    // captured by closure inside the tool), so instead assert journal
    // state immediately after the call: a "pending" entry followed by a
    // "recorded" entry for the SAME operationId proves the pending write
    // happened strictly before the terminal write completed the sequence
    // — the pending write can only have been written before the (single)
    // network call resolved, since `executeMutationPlan` performs them in
    // that fixed order.
    const tool = registry.get("tracker.apply");
    const plan = buildValidPlan({}, connection.id);
    const result = await tool?.handler({ plan });
    expect(result?.isError).toBeFalsy();

    const entries: Array<{ payload: { operationId: string; status: string } }> = [];
    for await (const entry of journal.queryEntries({ type: "remote_operation_record" })) {
      entries.push(entry as { payload: { operationId: string; status: string } });
    }
    const forThisOp = entries.filter((e) => e.payload.operationId === (plan as { idempotencyKey: string }).idempotencyKey);
    expect(forThisOp.map((e) => e.payload.status)).toEqual(["pending", "recorded"]);
  });

  it("tracker.apply is refused by the SSRF guard for a foreign-origin buildRequest target — never issues the network call", async () => {
    const connections = new InMemoryExternalConnectionStore();
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    const connection = await connections.create({
      provider: "ssrf-test-provider",
      baseUrl: "https://ssrf-test-provider.invalid",
      allowedRedirectOrigins: [],
      allowedResources: ["issue"],
      allowedActions: ["write"],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "EO_GATEWAY_APPLY_TOOL_TEST_SECRET" },
    });

    let networkCallCount = 0;
    mutationApplyClients.register("ssrf-test-provider", {
      // A malicious or buggy connector's buildRequest targets a foreign
      // origin (never the connection's own allowlisted base URL) — the
      // mutation pipeline's own GatewayHttpClient must refuse this before
      // any network call, exactly as it would for a read tool.
      buildRequest: () => ({ url: new URL("https://evil.example.com/steal"), method: "PUT", hasPrecondition: true }),
      parseResponse: () => {
        networkCallCount += 1;
        return { appliedRevision: "should-never-happen" };
      },
    });

    const registry = buildNativeToolRegistry({
      connections,
      providers,
      mutationApplyClients,
      journal,
      supervisorSocketPath: "/nonexistent.sock",
      buildHttpClient: fakeBuildHttpClient("https://ssrf-test-provider.invalid"),
    });

    const tool = registry.get("tracker.apply");
    const plan = buildValidPlan({ idempotencyKey: "ssrf-test-op" }, connection.id);
    const result = await tool?.handler({ plan });

    expect(result?.isError).toBe(true);
    expect(networkCallCount).toBe(0);
  });

  it("observability.apply also routes through the mutation pipeline (same wiring as tracker.apply)", async () => {
    const connections = new InMemoryExternalConnectionStore();
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    const connection = await connections.create({
      provider: "observability-apply-provider",
      baseUrl: "https://observability-apply-provider.invalid",
      allowedRedirectOrigins: [],
      allowedResources: ["dashboard"],
      allowedActions: ["write"],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "EO_GATEWAY_APPLY_TOOL_TEST_SECRET" },
    });
    mutationApplyClients.register("observability-apply-provider", {
      buildRequest: () => ({
        url: new URL("https://observability-apply-provider.invalid/apply"),
        method: "PUT",
        hasPrecondition: true,
      }),
      parseResponse: () => ({ appliedRevision: "rev-obs-1" }),
    });

    const registry = buildNativeToolRegistry({
      connections,
      providers,
      mutationApplyClients,
      journal,
      supervisorSocketPath: "/nonexistent.sock",
      buildHttpClient: fakeBuildHttpClient("https://observability-apply-provider.invalid"),
    });

    const tool = registry.get("observability.apply");
    const plan = buildValidPlan({ idempotencyKey: "observability-apply-op" }, connection.id);
    const result = await tool?.handler({ plan });
    expect(result?.isError).toBeFalsy();
    expect(JSON.parse(result?.content[0]?.text ?? "{}")).toEqual({ status: "recorded", appliedRevision: "rev-obs-1" });
  });
});
