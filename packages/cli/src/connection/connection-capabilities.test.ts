import { describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  EXIT_GENERAL_ERROR,
  EXIT_OK,
  type CapabilitySnapshot,
  type ExternalConnection,
} from "@eo/contracts";
import { InMemoryExternalConnectionStore } from "@eo/gateway";
import type { ConnectionDependencies } from "./connection-commands.js";
import { runConnectionCapabilitiesCommand } from "./connection-capabilities.js";

/**
 * WP5 (2026-07-25): `../commands/dispatch.ts` returned an UNCONDITIONAL
 * `notImplementedResult` for `connection-capabilities`, alone among the
 * four `connection *` verbs. This file drives the real backend, built to
 * `runConnectionDoctorCommand`'s injected-dependency shape — the discovery
 * function is supplied by the caller exactly as `probe` is, so the command
 * never has to hold credential-attaching HTTP code of its own.
 *
 * Written before `./connection-capabilities.ts` exists.
 */
async function storeWith(provider = "grafana"): Promise<{
  store: InMemoryExternalConnectionStore;
  connection: ExternalConnection;
}> {
  const store = new InMemoryExternalConnectionStore();
  const connection = await store.create({
    provider,
    baseUrl: "https://grafana.example.com",
    secretRef: { backend: "env", variable: "GRAFANA_TOKEN" },
    allowedRedirectOrigins: [],
    allowedResources: ["dashboard"],
    allowedActions: ["list"],
    discoveryTtlSeconds: 900,
  });
  return { store, connection };
}

function snapshotFor(connection: ExternalConnection): CapabilitySnapshot {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "00000000-0000-4000-8000-0000000000cc",
    externalConnectionId: connection.id,
    product: "grafana",
    edition: "oss",
    version: "13.1.0",
    apiFamilies: ["dashboard:legacy"],
    resources: ["dashboard"],
    actions: ["list", "get"],
    permissions: ["read"],
    isReadOnly: true,
    discoveredAt: "2026-07-25T00:00:00.000Z",
    expiresAt: "2026-07-25T00:15:00.000Z",
  };
}

function deps(
  store: InMemoryExternalConnectionStore,
  discoverCapabilities?: ConnectionDependencies["discoverCapabilities"],
): ConnectionDependencies {
  return {
    repository: store,
    probe: async () => ({ reachable: true, detail: "unused" }),
    ...(discoverCapabilities !== undefined ? { discoverCapabilities } : {}),
  };
}

describe("runConnectionCapabilitiesCommand", () => {
  it("reports the discovered snapshot as JSON", async () => {
    const { store, connection } = await storeWith();
    const result = await runConnectionCapabilitiesCommand(
      { command: "connection-capabilities", connectionId: connection.id, json: true },
      deps(store, async (c) => snapshotFor(c)),
    );
    expect(result.exitCode).toBe(EXIT_OK);
    const payload = JSON.parse(result.stdout!) as {
      version: string;
      isReadOnly: boolean;
      discovered: boolean;
    };
    expect(payload.version).toBe("13.1.0");
    expect(payload.isReadOnly).toBe(true);
    // The `--json` contract's own claim (see the module header): a
    // consumer branches on `discovered` ALONE, so the SUCCESS side of that
    // flag has to be asserted too. It was not, and flipping it to `false`
    // used to leave this whole file green.
    expect(payload.discovered).toBe(true);
  });

  /**
   * ADVERSARIAL-REVIEW FIX (2026-07-26). `provider` is the one field of the
   * projected payload that comes from the CONNECTION rather than from the
   * snapshot, and it was asserted nowhere — replacing it with a constant
   * survived the suite. Driven over a connection whose `provider` differs
   * from the snapshot's `product`, because with both equal to "grafana" any
   * hardcoded value would satisfy the assertion by coincidence. A `--json`
   * consumer routing on `provider` would be silently misrouted.
   */
  it("reports the CONNECTION's provider, not the discovered product", async () => {
    const { store, connection } = await storeWith("jira");
    const result = await runConnectionCapabilitiesCommand(
      { command: "connection-capabilities", connectionId: connection.id, json: true },
      // The snapshot still says `product: "grafana"` — the two fields answer
      // different questions and must not be conflated.
      deps(store, async (c) => snapshotFor(c)),
    );
    expect(result.exitCode).toBe(EXIT_OK);
    const payload = JSON.parse(result.stdout!) as {
      provider: string;
      product: string;
      connectionId: string;
    };
    expect(payload.provider).toBe("jira");
    expect(payload.product).toBe("grafana");
    expect(payload.connectionId).toBe(connection.id);
  });

  it("renders a human-readable line when --json is absent", async () => {
    const { store, connection } = await storeWith();
    const result = await runConnectionCapabilitiesCommand(
      { command: "connection-capabilities", connectionId: connection.id, json: false },
      deps(store, async (c) => snapshotFor(c)),
    );
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.stdout).toContain("grafana");
    expect(result.stdout).toContain("13.1.0");
    expect(result.stdout).toContain("read-only");
  });

  it("says writable, not read-only, for a writable snapshot", async () => {
    const { store, connection } = await storeWith();
    const result = await runConnectionCapabilitiesCommand(
      { command: "connection-capabilities", connectionId: connection.id, json: false },
      deps(store, async (c) => ({ ...snapshotFor(c), isReadOnly: false })),
    );
    expect(result.stdout).toContain("writable");
    expect(result.stdout).not.toContain("read-only");
  });

  it("fails with a precise message for an unknown connection id — and never calls the discoverer", async () => {
    const { store } = await storeWith();
    let called = false;
    const result = await runConnectionCapabilitiesCommand(
      { command: "connection-capabilities", connectionId: "no-such-id", json: false },
      deps(store, async (c) => {
        called = true;
        return snapshotFor(c);
      }),
    );
    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stderr).toContain('no connection with id "no-such-id"');
    expect(called).toBe(false);
  });

  it("renders the unknown-connection failure as JSON when asked", async () => {
    const { store } = await storeWith();
    const result = await runConnectionCapabilitiesCommand(
      { command: "connection-capabilities", connectionId: "no-such-id", json: true },
      deps(store, async (c) => snapshotFor(c)),
    );
    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(JSON.parse(result.stdout!)).toMatchObject({
      connectionId: "no-such-id",
      discovered: false,
    });
  });

  /**
   * A doctor command that crashed on an unreachable host would be useless
   * precisely when it is needed; the same reasoning applies here, and
   * discovery is strictly more failure-prone than a reachability probe.
   */
  it("reports a discovery failure as a typed result rather than throwing", async () => {
    const { store, connection } = await storeWith();
    const result = await runConnectionCapabilitiesCommand(
      { command: "connection-capabilities", connectionId: connection.id, json: false },
      deps(store, async () => {
        throw new Error("token expired");
      }),
    );
    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stderr).toContain("token expired");
  });

  it("renders a discovery failure as JSON when asked", async () => {
    const { store, connection } = await storeWith();
    const result = await runConnectionCapabilitiesCommand(
      { command: "connection-capabilities", connectionId: connection.id, json: true },
      deps(store, async () => {
        throw new Error("token expired");
      }),
    );
    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(JSON.parse(result.stdout!)).toMatchObject({
      connectionId: connection.id,
      discovered: false,
    });
  });

  /**
   * A discoverer is an injected function from another package; nothing
   * obliges it to throw an `Error` subclass. A rejected fetch, a thrown
   * string, or a rejected promise carrying a plain object must all still
   * produce the typed non-zero result rather than an unhandled rejection —
   * this is the `String(err)` half of the message-extraction branch.
   */
  it("survives a discoverer that throws a NON-Error value, stringifying it into the detail", async () => {
    const { store, connection } = await storeWith();
    const result = await runConnectionCapabilitiesCommand(
      { command: "connection-capabilities", connectionId: connection.id, json: true },
      // A rejected promise carrying a non-Error value — the shape a
      // transport wrapper produces when it rejects with a plain string.
      deps(store, () => Promise.reject("boom: transport closed")),
    );
    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    const payload = JSON.parse(result.stdout!) as { discovered: boolean; detail: string };
    expect(payload.discovered).toBe(false);
    expect(payload.detail).toContain("boom: transport closed");
  });

  it("refuses when no discoverer is supplied at all, naming the missing dependency", async () => {
    const { store, connection } = await storeWith();
    const result = await runConnectionCapabilitiesCommand(
      { command: "connection-capabilities", connectionId: connection.id, json: false },
      deps(store),
    );
    expect(result.exitCode).toBe(EXIT_GENERAL_ERROR);
    expect(result.stderr).toContain("no capability discoverer");
  });

  it("never prints the connection's secret reference in any branch", async () => {
    const { store, connection } = await storeWith();
    for (const json of [true, false]) {
      const result = await runConnectionCapabilitiesCommand(
        { command: "connection-capabilities", connectionId: connection.id, json },
        deps(store, async (c) => snapshotFor(c)),
      );
      expect(`${result.stdout ?? ""}${result.stderr ?? ""}`).not.toContain("GRAFANA_TOKEN");
    }
  });
});
