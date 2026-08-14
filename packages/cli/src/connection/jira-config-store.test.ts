import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { JiraConnectionConfig } from "@crabgic/connectors-jira";
import { FileJiraConnectionConfigStore } from "./jira-config-store.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function newStore(): Promise<FileJiraConnectionConfigStore> {
  const dir = await mkdtemp(join(tmpdir(), "eo-jira-config-"));
  dirs.push(dir);
  return new FileJiraConnectionConfigStore(join(dir, "jira-connection-configs.json"));
}

function config(overrides: Partial<JiraConnectionConfig> = {}): JiraConnectionConfig {
  return {
    externalConnectionId: "conn-1",
    deploymentType: "cloud",
    authMode: "basic",
    allowBasicAuth: false,
    basicAuthUsernameSecretRef: { backend: "env", variable: "JIRA_EMAIL" },
    basicAuthPasswordSecretRef: { backend: "env", variable: "JIRA_TOKEN" },
    ...overrides,
  };
}

/**
 * `ConnectionDependencies.discoverCapabilities` recorded the gap this
 * closes: "`JiraConnectionConfigSchema` gained `oauthClientIdSecretRef`/
 * `oauthClientSecretRef` in WP5, but NOTHING PERSISTS a
 * `JiraConnectionConfig`, and P02's `ExternalConnection` carries exactly
 * ONE `secretRef` by a roadmap/19 ruling that must not be widened." So
 * the connector's own config shape is the storage, kept beside the
 * connection rather than folded into it.
 */
describe("FileJiraConnectionConfigStore", () => {
  it("round-trips a config through a SEPARATE store instance over the same file", async () => {
    const store = await newStore();
    await store.put(config());
    // The real cross-process shape: `connection add` writes in one
    // process, `gateway mcp` reads in another.
    const second = new FileJiraConnectionConfigStore(store.path);
    expect(await second.get("conn-1")).toEqual(config());
  });

  it("returns undefined for a connection with no config rather than inventing a default", async () => {
    // A guessed authMode would pick a credential the operator never chose.
    const store = await newStore();
    expect(await store.get("absent")).toBeUndefined();
  });

  it("replaces a config for the same connection instead of accumulating duplicates", async () => {
    const store = await newStore();
    await store.put(config({ authMode: "basic" }));
    await store.put(config({ authMode: "oauth" }));
    expect((await store.get("conn-1"))?.authMode).toBe("oauth");
    expect(await store.list()).toHaveLength(1);
  });

  it("keeps configs for different connections independent", async () => {
    const store = await newStore();
    await store.put(config({ externalConnectionId: "a" }));
    await store.put(config({ externalConnectionId: "b", deploymentType: "datacenter" }));
    expect((await store.get("a"))?.deploymentType).toBe("cloud");
    expect((await store.get("b"))?.deploymentType).toBe("datacenter");
  });

  it("removes a config", async () => {
    const store = await newStore();
    await store.put(config());
    await store.remove("conn-1");
    expect(await store.get("conn-1")).toBeUndefined();
  });

  it("writes owner-only (0600) — the file names credential LOCATIONS", async () => {
    // Never credential material, but the set of secret references is still
    // a map of where this host's Jira credentials live.
    const store = await newStore();
    await store.put(config());
    expect((await stat(store.path)).mode & 0o777).toBe(0o600);
  });

  it("never persists resolved secret MATERIAL, only the reference locators", async () => {
    process.env.JIRA_TOKEN = "super-secret-token-value";
    try {
      const store = await newStore();
      await store.put(config());
      const raw = await readFile(store.path, "utf8");
      expect(raw).not.toContain("super-secret-token-value");
      expect(raw).toContain("JIRA_TOKEN");
    } finally {
      delete process.env.JIRA_TOKEN;
    }
  });

  it("validates on READ, so a hand-edited file cannot inject an unknown auth mode", async () => {
    const store = await newStore();
    await store.put(config());
    const { writeFile } = await import("node:fs/promises");
    await writeFile(store.path, JSON.stringify([{ ...config(), authMode: "trust-me" }]), "utf8");
    await expect(store.get("conn-1")).rejects.toThrow();
  });

  it("reports an empty store for a file that does not exist yet", async () => {
    const store = await newStore();
    expect(await store.list()).toEqual([]);
  });
});
