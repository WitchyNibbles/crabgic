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
import { FileExternalConnectionStore } from "@eo/gateway";
import { EXIT_GENERAL_ERROR, EXIT_NOT_IMPLEMENTED, EXIT_OK } from "../exit-codes.js";
import type { ConnectionDependencies } from "../connection/connection-commands.js";
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
    probe: () => Promise.resolve(probeResult),
  };
}

const ADD = {
  command: "connection-add",
  provider: "jira",
  reference: { raw: "env:JIRA_TOKEN" },
  baseUrl: "https://example.atlassian.net",
  allowedRedirectOrigins: ["https://example.atlassian.net"],
  allowedResources: ["issue"],
  allowedActions: ["read"],
  discoveryTtlSeconds: 900,
  json: true,
} as const;

describe("dispatchCommand — connection add|list|doctor, real backend when deps.connection is supplied", () => {
  it("adds a connection and lists it back from a SEPARATE store instance over the same file", async () => {
    const connection = await newConnectionDeps();

    const added = await dispatchCommand(ADD, { ...baseDeps(), connection });
    expect(added.exitCode).toBe(EXIT_OK);
    const created = JSON.parse(added.stdout ?? "{}") as { id: string; provider: string };
    expect(created.provider).toBe("jira");

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
   * Pinned deliberately: live `CapabilitySnapshot` discovery has no
   * production HTTP plumbing in either connector (phase 19/20 gap — see
   * `../connection/connection-commands.ts`). If someone wires it, this test
   * failing is the intended signal to delete it, not to re-stub the command.
   */
  it("connection capabilities remains NOT_IMPLEMENTED even WITH the bag — discovery is unbuilt", async () => {
    const result = await dispatchCommand(
      { command: "connection-capabilities", connectionId: "c-1", json: false },
      { ...baseDeps(), connection: await newConnectionDeps() },
    );
    expect(result.exitCode).toBe(EXIT_NOT_IMPLEMENTED);
  });
});
