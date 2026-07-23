import { describe, expect, it, afterEach } from "vitest";
import {
  ExternalConnectionNotFoundError,
  InMemoryExternalConnectionStore,
  resolveConnectionSecret,
} from "./external-connection-store.js";

const BASE_INPUT = {
  provider: "jira",
  baseUrl: "https://example.atlassian.net",
  allowedRedirectOrigins: [],
  allowedResources: ["issue"],
  allowedActions: ["read"],
  discoveryTtlSeconds: 900,
  secretRef: { backend: "env" as const, variable: "EO_GATEWAY_TEST_STORE_SECRET" },
};

describe("InMemoryExternalConnectionStore", () => {
  afterEach(() => {
    delete process.env.EO_GATEWAY_TEST_STORE_SECRET;
  });

  it("creates a connection and assigns an id + schemaVersion", async () => {
    const store = new InMemoryExternalConnectionStore();
    const created = await store.create(BASE_INPUT);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.schemaVersion).toBe(1);
    expect(created.provider).toBe("jira");
  });

  it("get returns undefined for an unknown id", async () => {
    const store = new InMemoryExternalConnectionStore();
    expect(await store.get("00000000-0000-4000-8000-000000000000")).toBeUndefined();
  });

  it("list returns every created connection", async () => {
    const store = new InMemoryExternalConnectionStore();
    await store.create(BASE_INPUT);
    await store.create({ ...BASE_INPUT, provider: "grafana" });
    const all = await store.list();
    expect(all).toHaveLength(2);
  });

  it("update replaces the record without mutating the prior object", async () => {
    const store = new InMemoryExternalConnectionStore();
    const created = await store.create(BASE_INPUT);
    const updated = await store.update(created.id, { discoveryTtlSeconds: 120 });
    expect(updated.discoveryTtlSeconds).toBe(120);
    expect(updated.id).toBe(created.id);
    expect(created.discoveryTtlSeconds).toBe(900); // original object untouched
  });

  it("update throws ExternalConnectionNotFoundError for an unknown id", async () => {
    const store = new InMemoryExternalConnectionStore();
    await expect(
      store.update("00000000-0000-4000-8000-000000000000", { discoveryTtlSeconds: 60 }),
    ).rejects.toBeInstanceOf(ExternalConnectionNotFoundError);
  });

  it("remove deletes a connection; a second remove is a no-op", async () => {
    const store = new InMemoryExternalConnectionStore();
    const created = await store.create(BASE_INPUT);
    await store.remove(created.id);
    expect(await store.get(created.id)).toBeUndefined();
    await expect(store.remove(created.id)).resolves.toBeUndefined();
  });
});

describe("resolveConnectionSecret", () => {
  it("resolves the connection's secretRef via the shared resolver", async () => {
    process.env.EO_GATEWAY_TEST_STORE_SECRET = "resolved-value";
    const store = new InMemoryExternalConnectionStore();
    const created = await store.create(BASE_INPUT);
    await expect(resolveConnectionSecret(created)).resolves.toBe("resolved-value");
  });
});
