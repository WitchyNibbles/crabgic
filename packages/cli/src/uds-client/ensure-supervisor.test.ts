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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SupervisorUnavailableError } from "../errors.js";
import type { UdsClient } from "./client.js";
import {
  ensureSupervisorConnection,
  readSupervisordStderrTail,
  resolveSupervisordBin,
  retryDelay,
} from "./ensure-supervisor.js";

const FAKE_CLIENT = { close: () => Promise.resolve() } as unknown as UdsClient;

function unavailable(): never {
  throw new SupervisorUnavailableError("no socket");
}

/**
 * REGRESSION (2026-07-28, observed live before it was understood). Every
 * test in this file injects `retryDelayMs`, and vitest's own event loop is
 * kept alive by the runner — so the retry wait could be, and was, an
 * `unref()`'d timer and no test here could tell. In a real one-shot CLI
 * process nothing else holds the loop: `spawnSupervisorDaemon` detaches and
 * `unref()`s the child, the failed connect closes its socket, and an
 * `unref()`'d retry timer lets Node drain and exit **0 with no output at
 * all** — so `status`/`resume`/`cancel` silently no-op'd against a project
 * whose daemon was not already running, instead of reporting
 * `SupervisorUnavailableError`. Reproduced by hand three times at
 * `crabgic@1.3.0`; correct output returned the moment a daemon was started
 * manually.
 *
 * The contract this pins is therefore about the PROCESS, not the promise: a
 * pending retry must hold the event loop open. It is asserted on the timer
 * because that is the only in-process observable — a subprocess test would
 * need a build step to exist first, and would not fail any faster.
 */
describe("retryDelay — a pending retry keeps the process alive", () => {
  it("does not unref its timer", async () => {
    const { promise, timer } = retryDelay(1);
    expect(timer.hasRef()).toBe(true);
    await promise;
  });
});

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

/**
 * Passive mode — added 2026-07-27 for the manager Stop hook
 * (`packages/plugin/hooks/stop-autonomy-gate.mjs`).
 *
 * The hook asks "is a run still in flight?" on every Stop event, in a session
 * that may have nothing to do with Crabgic. The ordinary spawn-on-demand
 * policy is exactly wrong there: booting a supervisor daemon as a side effect
 * of a session ending would be a surprising process to start, and the retry
 * budget (25 attempts x 200ms) would stall the turn for seconds before
 * concluding what passive mode learns immediately — that no daemon is running,
 * so no run can be in flight, so the hook has nothing to say.
 */
describe("ensureSupervisorConnection — passive mode", () => {
  it("never spawns, and surfaces unavailability immediately", async () => {
    let spawns = 0;
    let attempts = 0;
    await expect(
      ensureSupervisorConnection({
        connect: () => {
          attempts += 1;
          return Promise.resolve(unavailable());
        },
        spawnDaemon: () => {
          spawns += 1;
        },
        spawn: false,
        retryDelayMs: 1,
      }),
    ).rejects.toBeInstanceOf(SupervisorUnavailableError);
    expect(spawns).toBe(0);
    // One attempt only: with no spawn there is nothing for a retry to wait for.
    expect(attempts).toBe(1);
  });

  it("still returns a client when the daemon happens to already be up", async () => {
    let spawns = 0;
    const client = await ensureSupervisorConnection({
      connect: () => Promise.resolve(FAKE_CLIENT),
      spawnDaemon: () => {
        spawns += 1;
      },
      spawn: false,
    });
    expect(client).toBe(FAKE_CLIENT);
    expect(spawns).toBe(0);
  });

  it("propagates a non-unavailable error untouched, exactly as active mode does", async () => {
    const boom = new Error("handshake rejected");
    await expect(
      ensureSupervisorConnection({
        connect: () => Promise.reject(boom),
        spawnDaemon: () => {
          throw new Error("must not spawn");
        },
        spawn: false,
      }),
    ).rejects.toBe(boom);
  });

  it("defaults to active spawn-on-demand when the flag is omitted", async () => {
    let spawns = 0;
    let attempts = 0;
    const client = await ensureSupervisorConnection({
      connect: () => {
        attempts += 1;
        return attempts === 1 ? Promise.resolve(unavailable()) : Promise.resolve(FAKE_CLIENT);
      },
      spawnDaemon: () => {
        spawns += 1;
      },
      retryDelayMs: 1,
    });
    expect(client).toBe(FAKE_CLIENT);
    expect(spawns).toBe(1);
  });
});

/**
 * Spawn diagnostics — added 2026-07-29. The daemon is spawned detached with
 * its stderr discarded, so when it dies during startup the CLI's only report
 * was a generic "unreachable" after the whole retry budget — the actual
 * fatal message (`bin/supervisord.ts`'s last words) went nowhere. The spawner
 * now points the daemon's stderr at a log file, and once the retry budget is
 * exhausted the error carries that file's tail: the user reads WHY the daemon
 * died, not just that nothing answered.
 */
describe("ensureSupervisorConnection — spawn diagnostics", () => {
  it("carries the spawned daemon's stderr tail on the exhaustion error", async () => {
    const err = await ensureSupervisorConnection({
      connect: () => unavailable(),
      spawnDaemon: () => {},
      readSpawnDiagnostics: () => "FATAL: lease directory is not writable",
      retryDelayMs: 1,
      maxAttempts: 2,
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(err).toBeInstanceOf(SupervisorUnavailableError);
    expect((err as Error).message).toContain("FATAL: lease directory is not writable");
    expect((err as Error).message).toContain("could not reach the supervisor control socket");
  });

  it("throws the plain unavailability error when diagnostics come back undefined", async () => {
    const err = await ensureSupervisorConnection({
      connect: () => unavailable(),
      spawnDaemon: () => {},
      readSpawnDiagnostics: () => undefined,
      retryDelayMs: 1,
      maxAttempts: 2,
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(err).toBeInstanceOf(SupervisorUnavailableError);
    expect((err as Error).message).not.toContain("reported");
  });

  it("never consults diagnostics in passive mode (nothing was spawned)", async () => {
    let reads = 0;
    await expect(
      ensureSupervisorConnection({
        connect: () => unavailable(),
        spawnDaemon: () => {
          throw new Error("must not spawn");
        },
        readSpawnDiagnostics: () => {
          reads += 1;
          return "irrelevant";
        },
        spawn: false,
      }),
    ).rejects.toBeInstanceOf(SupervisorUnavailableError);
    expect(reads).toBe(0);
  });

  it("never consults diagnostics when the connection succeeds", async () => {
    let reads = 0;
    let attempts = 0;
    await ensureSupervisorConnection({
      connect: () => {
        attempts += 1;
        return attempts === 1 ? Promise.resolve(unavailable()) : Promise.resolve(FAKE_CLIENT);
      },
      spawnDaemon: () => {},
      readSpawnDiagnostics: () => {
        reads += 1;
        return "irrelevant";
      },
      retryDelayMs: 1,
    });
    expect(reads).toBe(0);
  });

  it("a throwing diagnostics reader never masks the unavailability error", async () => {
    const err = await ensureSupervisorConnection({
      connect: () => unavailable(),
      spawnDaemon: () => {},
      readSpawnDiagnostics: () => {
        throw new Error("log file exploded");
      },
      retryDelayMs: 1,
      maxAttempts: 2,
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(err).toBeInstanceOf(SupervisorUnavailableError);
    expect((err as Error).message).not.toContain("log file exploded");
  });
});

describe("readSupervisordStderrTail", () => {
  let dir: string;
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns undefined for a missing file", () => {
    dir = mkdtempSync(join(tmpdir(), "eo-stderr-tail-"));
    expect(readSupervisordStderrTail(join(dir, "absent.log"))).toBeUndefined();
  });

  it("returns undefined for an empty or whitespace-only file", () => {
    dir = mkdtempSync(join(tmpdir(), "eo-stderr-tail-"));
    const path = join(dir, "empty.log");
    writeFileSync(path, "  \n\n");
    expect(readSupervisordStderrTail(path)).toBeUndefined();
  });

  it("returns the trimmed contents of a short file", () => {
    dir = mkdtempSync(join(tmpdir(), "eo-stderr-tail-"));
    const path = join(dir, "short.log");
    writeFileSync(path, "FATAL: something specific\n");
    expect(readSupervisordStderrTail(path)).toBe("FATAL: something specific");
  });

  it("returns only the last maxBytes of a long file", () => {
    dir = mkdtempSync(join(tmpdir(), "eo-stderr-tail-"));
    const path = join(dir, "long.log");
    writeFileSync(path, `${"x".repeat(10_000)}\nTHE END`);
    const tail = readSupervisordStderrTail(path, 64);
    expect(tail).toBeDefined();
    expect(tail!.length).toBeLessThanOrEqual(64);
    expect(tail).toContain("THE END");
  });
});

/**
 * The daemon entry point must resolve in BOTH layouts this package ships in.
 *
 * Found 2026-07-30 by running the built binary: the bundled (published) layout
 * put this module at the dist root, so the single `../bin/supervisord.js`
 * candidate resolved to `packages/cli/bin/supervisord.js` — a path that never
 * existed — and every daemon spawn in the published package died with
 * MODULE_NOT_FOUND behind a generic "unreachable socket".
 */
describe("resolveSupervisordBin", () => {
  let dir: string;
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves the bundled layout, where this module sits at the dist root beside bin/", () => {
    dir = mkdtempSync(join(tmpdir(), "eo-bin-bundled-"));
    mkdirSync(join(dir, "bin"), { recursive: true });
    writeFileSync(join(dir, "bin", "supervisord.js"), "// daemon\n");

    const resolved = resolveSupervisordBin(pathToFileURL(join(dir, "chunk-ABC123.js")).href);
    expect(resolved).toBe(join(dir, "bin", "supervisord.js"));
  });

  it("resolves the tsc layout, where this module sits one directory below bin/", () => {
    dir = mkdtempSync(join(tmpdir(), "eo-bin-tsc-"));
    mkdirSync(join(dir, "bin"), { recursive: true });
    mkdirSync(join(dir, "uds-client"), { recursive: true });
    writeFileSync(join(dir, "bin", "supervisord.js"), "// daemon\n");

    const resolved = resolveSupervisordBin(
      pathToFileURL(join(dir, "uds-client", "ensure-supervisor.js")).href,
    );
    expect(resolved).toBe(join(dir, "bin", "supervisord.js"));
  });

  it("throws naming EVERY candidate when the daemon entry is genuinely absent, rather than returning a path that cannot run", () => {
    dir = mkdtempSync(join(tmpdir(), "eo-bin-absent-"));
    const moduleUrl = pathToFileURL(join(dir, "chunk-ABC123.js")).href;
    expect(() => resolveSupervisordBin(moduleUrl)).toThrow(/was not found/);
    expect(() => resolveSupervisordBin(moduleUrl)).toThrow(/packaging fault/);
  });
});

/*
 * NOTE deliberately NOT asserted here: "the daemon resolves in this build's
 * own layout". Vitest runs from `src/`, where the daemon is still
 * `supervisord.ts`, so no candidate can exist and the assertion would be
 * vacuous or wrong depending on which way it was written. The claim that
 * matters — the PUBLISHED layout resolves — is only meaningful against a real
 * packed tarball, and `scripts/check-install-smoke.mjs` asserts it there. That
 * split is the lesson this bug taught twice: the bundled layout is not the
 * source layout, and only the real artifact can prove it works.
 */
