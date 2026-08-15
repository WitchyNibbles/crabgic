/**
 * `dispatchCommand`'s conditional routing for `connection add|list|doctor`
 * (roadmap/16-gateway-core.md) — when `deps.connection` IS supplied, these
 * commands hit the real backend rather than `NOT_IMPLEMENTED`.
 *
 * roadmap/16 §Out of scope left the command surface to 09 ("ships it
 * `NOT_IMPLEMENTED` until wired") and 09 §Out of scope deferred the real
 * behavior back to 16 — so nothing ever wired the two halves together.
 * These tests are that seam.
 *
 * The repository is a REAL `FileExternalConnectionStore` over a tmp dir, not
 * a fake: `connection add` and `connection list` run in separate processes
 * in production, and an in-memory double would hide exactly the durability
 * bug that matters. Only the network probe is injected.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileExternalConnectionStore } from "@crabgic/gateway";
import { CURRENT_SCHEMA_VERSION } from "@crabgic/contracts";
import { EXIT_GENERAL_ERROR, EXIT_NOT_IMPLEMENTED, EXIT_OK } from "../exit-codes.js";
import type { ConnectionDependencies } from "../connection/connection-commands.js";
import { withProviderKeyNormalization } from "../connection/provider-keys.js";
import { FileJiraConnectionConfigStore } from "../connection/jira-config-store.js";
import { dispatchCommand } from "./dispatch.js";
import type { CliDependencies } from "./types.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function baseDeps(): Pick<CliDependencies, "connectClient" | "journal" | "projectHash"> {
  return {
    connectClient: () => {
      throw new Error("not needed for this test");
    },
    journal: {
      queryEntries: async function* () {
        /* no entries */
      },
      verifyJournal: async () => ({ ok: true, entries: 0 }) as never,
    },
    projectHash: "test-hash",
  };
}

async function newConnectionDeps(
  probeResult = { reachable: true, detail: "HTTP 200" },
): Promise<ConnectionDependencies> {
  const dir = await mkdtemp(join(tmpdir(), "eo-conn-dispatch-"));
  dirs.push(dir);
  return {
    repository: new FileExternalConnectionStore(join(dir, "connections.json")),
    jiraConfigs: new FileJiraConnectionConfigStore(join(dir, "jira-connection-configs.json")),
    probe: () => Promise.resolve(probeResult),
  };
}

const ADD = {
  command: "connection-add",
  provider: "jira",
  reference: { raw: "env:JIRA_TOKEN" },
  // Cloud defaults to basic auth (Atlassian's API-token mechanism), which
  // needs the account email as well as the token.
  usernameReference: { raw: "env:JIRA_EMAIL" },
  baseUrl: "https://example.atlassian.net",
  allowedRedirectOrigins: ["https://example.atlassian.net"],
  allowedResources: ["issue"],
  allowedActions: ["read"],
  discoveryTtlSeconds: 900,
  allowBasicAuth: false,
  json: true,
} as const;

describe("dispatchCommand — connection add|list|doctor, real backend when deps.connection is supplied", () => {
  it("adds a connection and lists it back from a SEPARATE store instance over the same file", async () => {
    const connection = await newConnectionDeps();

    const added = await dispatchCommand(ADD, { ...baseDeps(), connection });
    expect(added.exitCode).toBe(EXIT_OK);
    const created = JSON.parse(added.stdout ?? "{}") as { id: string; provider: string };
    // NOT the argv word "jira": issue #135 defect 2 — the stored `provider`
    // IS the provider-dispatch key, and `"jira"` matches no registration.
    expect(created.provider).toBe("jira-cloud");

    // A fresh repository over the same path — the real cross-process shape.
    const listed = await dispatchCommand(
      { command: "connection-list", json: true },
      {
        ...baseDeps(),
        connection: {
          ...connection,
          repository: new FileExternalConnectionStore(
            (connection.repository as FileExternalConnectionStore).path,
          ),
        },
      },
    );
    const { connections } = JSON.parse(listed.stdout ?? "{}") as {
      connections: { id: string }[];
    };
    expect(connections.map((c) => c.id)).toEqual([created.id]);
  });

  it("never prints resolved secret MATERIAL — only the reference locator", async () => {
    const connection = await newConnectionDeps();
    process.env.JIRA_TOKEN = "super-secret-token-value";
    try {
      const added = await dispatchCommand(ADD, { ...baseDeps(), connection });
      const listed = await dispatchCommand(
        { command: "connection-list", json: true },
        { ...baseDeps(), connection },
      );
      for (const out of [added.stdout ?? "", listed.stdout ?? ""]) {
        expect(out).not.toContain("super-secret-token-value");
        expect(out).toContain("env:JIRA_TOKEN"); // the locator is fine
      }
    } finally {
      delete process.env.JIRA_TOKEN;
    }
  });

  it("reports an empty store without failing, on a machine with nothing configured", async () => {
    const result = await dispatchCommand(
      { command: "connection-list", json: false },
      { ...baseDeps(), connection: await newConnectionDeps() },
    );
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.stdout).toContain("no external connections configured");
  });

  it("connection doctor reports reachable, and exits non-zero when unreachable", async () => {
    const reachable = await newConnectionDeps();
    const added = await dispatchCommand(ADD, { ...baseDeps(), connection: reachable });
    const { id } = JSON.parse(added.stdout ?? "{}") as { id: string };

    const ok = await dispatchCommand(
      { command: "connection-doctor", connectionId: id, json: true },
      { ...baseDeps(), connection: reachable },
    );
    expect(ok.exitCode).toBe(EXIT_OK);
    expect(JSON.parse(ok.stdout ?? "{}")).toMatchObject({ reachable: true, connectionId: id });

    // Same stored connection, a probe that reports failure: an unreachable
    // connector must be a non-zero exit an operator's script can branch on.
    const down: ConnectionDependencies = {
      repository: reachable.repository,
      probe: () => Promise.resolve({ reachable: false, detail: "connect ETIMEDOUT" }),
    };
    const bad = await dispatchCommand(
      { command: "connection-doctor", connectionId: id, json: true },
      { ...baseDeps(), connection: down },
    );
    expect(bad.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(JSON.parse(bad.stdout ?? "{}")).toMatchObject({ reachable: false });
  });

  it("connection doctor fails informatively for an unknown id rather than crashing", async () => {
    const result = await dispatchCommand(
      { command: "connection-doctor", connectionId: "nope", json: false },
      { ...baseDeps(), connection: await newConnectionDeps() },
    );
    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stderr).toContain("nope");
  });

  it("still returns the typed NOT_IMPLEMENTED shape for every connection command when deps.connection is absent", async () => {
    for (const command of [
      ADD,
      { command: "connection-list", json: false },
      { command: "connection-doctor", connectionId: "c-1", json: false },
      { command: "connection-capabilities", connectionId: "c-1", json: false },
    ] as const) {
      const result = await dispatchCommand(command, baseDeps());
      expect(result.exitCode).toBe(EXIT_NOT_IMPLEMENTED);
    }
  });

  /**
   * Pinned deliberately: the `connection-capabilities` BACKEND now exists
   * (`../connection/connection-capabilities.ts`), but the bag production
   * builds supplies no `discoverCapabilities`, because neither connector
   * can discover without something that would have to be invented — see
   * `ConnectionDependencies.discoverCapabilities` for the exact two
   * blockers. So the shipped binary still answers NOT_IMPLEMENTED here,
   * and `e2e/live`'s sweep still sees it. When a real discoverer is
   * supplied, this test failing is the signal to delete it and drop the
   * allowlist entry — never to re-stub the command.
   */
  it("connection capabilities is NOT_IMPLEMENTED with the bag but NO discoverer", async () => {
    const result = await dispatchCommand(
      { command: "connection-capabilities", connectionId: "c-1", json: false },
      { ...baseDeps(), connection: await newConnectionDeps() },
    );
    expect(result.exitCode).toBe(EXIT_NOT_IMPLEMENTED);
  });

  /** The branch is no longer UNCONDITIONAL: an injected discoverer reaches the real backend. */
  it("connection capabilities reaches the real backend once a discoverer IS supplied", async () => {
    const connection = await newConnectionDeps();
    const created = await connection.repository.create({
      provider: "grafana",
      baseUrl: "https://grafana.example.com",
      secretRef: { backend: "env", variable: "GRAFANA_TOKEN" },
      allowedRedirectOrigins: [],
      allowedResources: ["dashboard"],
      allowedActions: ["list"],
      discoveryTtlSeconds: 900,
    });

    const result = await dispatchCommand(
      { command: "connection-capabilities", connectionId: created.id, json: true },
      {
        ...baseDeps(),
        connection: {
          ...connection,
          discoverCapabilities: async () => ({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            id: "00000000-0000-4000-8000-0000000000cc",
            externalConnectionId: created.id,
            product: "grafana",
            edition: "oss",
            version: "13.1.0",
            apiFamilies: ["dashboard:legacy"],
            resources: ["dashboard"],
            actions: ["list"],
            permissions: ["read"],
            isReadOnly: true,
            discoveredAt: "2026-07-25T00:00:00.000Z",
            expiresAt: "2026-07-25T00:15:00.000Z",
          }),
        },
      },
    );

    expect(result.exitCode).not.toBe(EXIT_NOT_IMPLEMENTED);
    expect(JSON.parse(result.stdout!)).toMatchObject({ discovered: true, version: "13.1.0" });
  });
});

/**
 * Issue #135, defect 2 — end-to-end through the REAL file store, because
 * the whole defect lived in the gap between what one process writes and
 * what another process resolves. `../connection/provider-keys.test.ts`
 * pins the mapping itself; these pin that `connection add` actually
 * applies it, and that a record persisted by 1.7.0 becomes dispatchable
 * without the operator re-adding it.
 */
describe("connection add — the stored provider is the provider-dispatch key", () => {
  it("stores the Data Center key for --deployment datacenter", async () => {
    const connection = await newConnectionDeps();
    const added = await dispatchCommand(
      { ...ADD, deploymentType: "datacenter" },
      { ...baseDeps(), connection },
    );
    expect(JSON.parse(added.stdout ?? "{}")).toMatchObject({ provider: "jira-datacenter" });
  });

  it("stores grafana under its own key", async () => {
    const connection = await newConnectionDeps();
    const added = await dispatchCommand(
      { ...ADD, provider: "grafana", baseUrl: "https://grafana.example.com" },
      { ...baseDeps(), connection },
    );
    expect(JSON.parse(added.stdout ?? "{}")).toMatchObject({ provider: "grafana" });
  });

  it("records the deployment it resolved, so the record says which Jira it is", async () => {
    const connection = await newConnectionDeps();
    const added = await dispatchCommand(ADD, { ...baseDeps(), connection });
    expect(JSON.parse(added.stdout ?? "{}")).toMatchObject({
      provider: "jira-cloud",
      deploymentType: "cloud",
    });
  });

  it("refuses an unknown --deployment for jira instead of storing an un-dispatchable record", async () => {
    const connection = await newConnectionDeps();
    const result = await dispatchCommand(
      { ...ADD, deploymentType: "server" },
      { ...baseDeps(), connection },
    );
    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stderr).toMatch(/cloud\|datacenter/);
    // The refusal happens BEFORE `create`, so nothing un-dispatchable lands.
    expect(await connection.repository.list()).toEqual([]);
  });

  it("migrates a legacy 1.7.0 record on read, so `connection list` shows a dispatchable key", async () => {
    const connection = await newConnectionDeps();
    // Written the way 1.7.0 wrote it — straight through the inner store,
    // bypassing the CLI's own mapping.
    const legacy = await connection.repository.create({
      provider: "jira",
      baseUrl: "https://example.atlassian.net",
      allowedRedirectOrigins: [],
      allowedResources: ["issue"],
      allowedActions: ["read"],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "JIRA_TOKEN" },
    });
    expect(legacy.provider).toBe("jira");

    const migrating = withProviderKeyNormalization(
      new FileExternalConnectionStore((connection.repository as FileExternalConnectionStore).path),
    );
    const listed = await dispatchCommand(
      { command: "connection-list", json: true },
      { ...baseDeps(), connection: { ...connection, repository: migrating } },
    );
    const { connections } = JSON.parse(listed.stdout ?? "{}") as {
      connections: { id: string; provider: string }[];
    };
    expect(connections).toEqual([
      expect.objectContaining({ id: legacy.id, provider: "jira-cloud" }),
    ]);
  });
});

/**
 * A Jira connection whose credential shape has nowhere to be recorded
 * cannot authenticate, so `connection add` refuses rather than reporting
 * success — the "added fine, fails on first dispatch" outcome is exactly
 * what issue #135 was.
 */
describe("connection add — a Jira connection needs somewhere to record its credential shape", () => {
  it("refuses when no Jira config store is wired, instead of silently skipping it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eo-conn-nocfg-"));
    dirs.push(dir);
    const connection: ConnectionDependencies = {
      repository: new FileExternalConnectionStore(join(dir, "connections.json")),
      probe: () => Promise.resolve({ reachable: true, detail: "HTTP 200" }),
    };
    const result = await dispatchCommand(ADD, { ...baseDeps(), connection });
    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stderr).toMatch(/config store/);
  });

  it("still adds a Grafana connection with no Jira config store wired", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eo-conn-nocfg-grafana-"));
    dirs.push(dir);
    const connection: ConnectionDependencies = {
      repository: new FileExternalConnectionStore(join(dir, "connections.json")),
      probe: () => Promise.resolve({ reachable: true, detail: "HTTP 200" }),
    };
    const result = await dispatchCommand(
      { ...ADD, provider: "grafana", baseUrl: "https://grafana.example.com" },
      { ...baseDeps(), connection },
    );
    expect(result.exitCode).toBe(EXIT_OK);
  });
});
