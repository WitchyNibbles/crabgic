/**
 * `FileExternalConnectionStore` — the durable half of roadmap/16 §In scope's
 * "`ExternalConnection` store (02 schema; this phase implements the store)
 * — CRUD + secret-reference resolution".
 *
 * Phase 16 shipped `InMemoryExternalConnectionStore` only, which is correct
 * for the gateway's own in-process use but cannot back the CLI: `connection
 * add` runs in one short-lived process and `connection list`/`doctor` run in
 * later ones, so an in-memory repository would lose every connection the
 * moment the command exited. These tests pin the property that actually
 * matters for that use — a record written by one store instance is readable,
 * byte-identical, by a completely separate instance over the same path.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileExternalConnectionStore } from "./file-external-connection-store.js";
import { ExternalConnectionNotFoundError } from "./external-connection-store.js";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eo-conn-store-"));
  path = join(dir, "connections.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function newConnection(overrides: Record<string, unknown> = {}) {
  return {
    provider: "jira",
    baseUrl: "https://example.atlassian.net",
    allowedRedirectOrigins: ["https://example.atlassian.net"],
    allowedResources: ["issue"],
    allowedActions: ["read"],
    discoveryTtlSeconds: 900,
    secretRef: { backend: "env" as const, variable: "JIRA_TOKEN" },
    ...overrides,
  } as Parameters<FileExternalConnectionStore["create"]>[0];
}

describe("FileExternalConnectionStore", () => {
  it("lists nothing when the backing file does not exist yet, rather than throwing", async () => {
    const store = new FileExternalConnectionStore(path);
    expect(await store.list()).toEqual([]);
    expect(await store.get("nope")).toBeUndefined();
  });

  it("persists a created connection so a SEPARATE store instance reads it back identically", async () => {
    const created = await new FileExternalConnectionStore(path).create(newConnection());

    // A brand-new instance over the same path — this is the whole point:
    // `connection add` and `connection list` are different processes.
    const reread = await new FileExternalConnectionStore(path).get(created.id);
    expect(reread).toEqual(created);
    expect(created.schemaVersion).toBe(1);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("assigns a distinct id per connection and lists them all", async () => {
    const store = new FileExternalConnectionStore(path);
    const a = await store.create(newConnection());
    const b = await store.create(newConnection({ provider: "grafana" }));

    expect(a.id).not.toBe(b.id);
    const listed = await new FileExternalConnectionStore(path).list();
    expect(listed.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("updates a record without mutating the stored original, and persists the replacement", async () => {
    const store = new FileExternalConnectionStore(path);
    const created = await store.create(newConnection());
    const snapshotBefore = { ...created };

    const updated = await store.update(created.id, { deploymentType: "cloud" });

    expect(updated.deploymentType).toBe("cloud");
    expect(updated.id).toBe(created.id);
    // The object handed back by `create` is untouched — no in-place mutation.
    expect(created).toEqual(snapshotBefore);
    expect((await new FileExternalConnectionStore(path).get(created.id))?.deploymentType).toBe(
      "cloud",
    );
  });

  it("removes a record durably", async () => {
    const store = new FileExternalConnectionStore(path);
    const created = await store.create(newConnection());
    await store.remove(created.id);
    expect(await new FileExternalConnectionStore(path).get(created.id)).toBeUndefined();
  });

  it("throws ExternalConnectionNotFoundError for update/remove of an unknown id", async () => {
    const store = new FileExternalConnectionStore(path);
    await expect(store.update("missing", { deploymentType: "cloud" })).rejects.toBeInstanceOf(
      ExternalConnectionNotFoundError,
    );
    await expect(store.remove("missing")).rejects.toBeInstanceOf(ExternalConnectionNotFoundError);
  });

  it("fails closed on a tampered/corrupt backing file rather than returning unvalidated records", async () => {
    const store = new FileExternalConnectionStore(path);
    await store.create(newConnection());

    // A record whose baseUrl is plain http:// — exactly what the schema's
    // https-only refinement exists to reject. Reading it back must throw,
    // never hand a downgraded connection to the SSRF-guarded HTTP client.
    await writeFile(
      path,
      JSON.stringify([
        { schemaVersion: 1, id: "x", provider: "jira", baseUrl: "http://evil.test" },
      ]),
      "utf8",
    );
    await expect(new FileExternalConnectionStore(path).list()).rejects.toThrow();
  });

  it("writes the file with owner-only permissions — it names secret references", async () => {
    const store = new FileExternalConnectionStore(path);
    await store.create(newConnection());
    const { mode } = await stat(path);
    expect(mode & 0o777).toBe(0o600);
  });

  it("never writes resolved secret MATERIAL to disk — only the reference", async () => {
    const store = new FileExternalConnectionStore(path);
    await store.create(newConnection());
    const raw = await readFile(path, "utf8");
    expect(raw).toContain("JIRA_TOKEN"); // the reference name is fine
    expect(raw).not.toContain("secretValue");
  });
});
