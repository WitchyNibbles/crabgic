/**
 * Spawn-on-demand connection — roadmap/05-supervisor-daemon.md §Lifecycle:
 * "started on demand by the CLI (09)". Until the phase-23 final-wiring pass,
 * `connectUdsClient` simply threw `SupervisorUnavailableError` when no daemon
 * was serving the project socket — nothing anywhere actually started one.
 *
 * `ensureSupervisorConnection` is the CLI-side half of that contract: try to
 * connect; on `SupervisorUnavailableError` (and ONLY that error) spawn the
 * daemon once, then retry with a bounded backoff until the socket answers or
 * the budget is exhausted. Both seams (`connect`, `spawnDaemon`) are
 * injected, so these tests never touch a real socket or process.
 */
import { describe, expect, it } from "vitest";
import { SupervisorUnavailableError } from "../errors.js";
import type { UdsClient } from "./client.js";
import { ensureSupervisorConnection } from "./ensure-supervisor.js";

const FAKE_CLIENT = { close: () => Promise.resolve() } as unknown as UdsClient;

function unavailable(): never {
  throw new SupervisorUnavailableError("no socket");
}

describe("ensureSupervisorConnection — CLI spawn-on-demand", () => {
  it("returns the client without spawning when the daemon is already up", async () => {
    let spawns = 0;
    const client = await ensureSupervisorConnection({
      connect: () => Promise.resolve(FAKE_CLIENT),
      spawnDaemon: () => {
        spawns += 1;
      },
      retryDelayMs: 1,
    });
    expect(client).toBe(FAKE_CLIENT);
    expect(spawns).toBe(0);
  });

  it("spawns the daemon exactly once, then retries until the socket answers", async () => {
    let spawns = 0;
    let attempts = 0;
    const client = await ensureSupervisorConnection({
      connect: () => {
        attempts += 1;
        // Unavailable until the (spawned) daemon has "come up" on attempt 3.
        if (attempts < 3) unavailable();
        return Promise.resolve(FAKE_CLIENT);
      },
      spawnDaemon: () => {
        spawns += 1;
      },
      retryDelayMs: 1,
      maxAttempts: 5,
    });
    expect(client).toBe(FAKE_CLIENT);
    expect(spawns).toBe(1);
    expect(attempts).toBe(3);
  });

  it("rethrows SupervisorUnavailableError once the retry budget is exhausted", async () => {
    let spawns = 0;
    let attempts = 0;
    await expect(
      ensureSupervisorConnection({
        connect: () => {
          attempts += 1;
          unavailable();
        },
        spawnDaemon: () => {
          spawns += 1;
        },
        retryDelayMs: 1,
        maxAttempts: 4,
      }),
    ).rejects.toBeInstanceOf(SupervisorUnavailableError);
    expect(spawns).toBe(1);
    expect(attempts).toBe(4);
  });

  it("propagates any non-unavailable error immediately, without spawning", async () => {
    let spawns = 0;
    await expect(
      ensureSupervisorConnection({
        connect: () => Promise.reject(new Error("handshake rejected")),
        spawnDaemon: () => {
          spawns += 1;
        },
        retryDelayMs: 1,
      }),
    ).rejects.toThrow("handshake rejected");
    expect(spawns).toBe(0);
  });

  it("propagates a spawn failure itself (daemon binary missing) rather than retrying forever", async () => {
    await expect(
      ensureSupervisorConnection({
        connect: () => unavailable(),
        spawnDaemon: () => {
          throw new Error("ENOENT: supervisord not found");
        },
        retryDelayMs: 1,
      }),
    ).rejects.toThrow("ENOENT");
  });
});
