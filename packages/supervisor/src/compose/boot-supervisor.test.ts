/**
 * Process boot layer — roadmap/05-supervisor-daemon.md §Lifecycle: "started
 * on demand by the CLI (09); exactly one live instance per project, enforced
 * by 04's PID/start-time-validated lease." `bootSupervisor` wraps the pure
 * `composeSupervisor` control-plane root with the process-level concerns the
 * daemon owns: acquire the single-instance project lease FIRST (a second
 * daemon for the same project is refused), then compose + serve, then install
 * signal handlers that gracefully close the control plane and release the
 * lease.
 *
 * Every process-level seam (the signal registration, the shutdown callback,
 * even `composeSupervisor` itself) is injected so these tests never install a
 * real `process.on` handler, never call `process.exit`, and can drive the
 * lease-release-on-compose-failure path deterministically — mirroring how
 * `packages/cli`'s `bin.ts` keeps the real-process shim thin and untested and
 * pushes every branch into an injectable, unit-tested function.
 */
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { XdgEnv } from "@crabgic/journal";
import { readPeerCredentialsLinux } from "../peer-auth/peer-credentials.js";
import { connectTestClient } from "../socket/test-support/supervisor-test-client.js";
import {
  bootSupervisor,
  SupervisorAlreadyRunningError,
  type BootedSupervisor,
} from "./boot-supervisor.js";

const PROJECT_HASH = "boothash00000002";

let root: string;
let env: XdgEnv;
let leaseDir: string;
let leaseFile: string;
let booted: BootedSupervisor | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-supervisor-boot-"));
  env = { HOME: root, XDG_STATE_HOME: join(root, "state") };
  leaseDir = join(root, "leases");
  leaseFile = join(leaseDir, `${PROJECT_HASH}.lease.json`);
});

afterEach(async () => {
  await booted?.shutdown();
  booted = undefined;
  await rm(root, { recursive: true, force: true });
});

function baseConfig() {
  return {
    env,
    projectHash: PROJECT_HASH,
    peerAuth: { reader: readPeerCredentialsLinux },
    leaseDir,
    leaseOptions: { autoRenew: false as const },
  };
}

describe("bootSupervisor — daemon process boot + single-instance lease", () => {
  it("acquires the lease, starts the control plane, then releases the lease on shutdown", async () => {
    booted = await bootSupervisor(baseConfig());

    expect(booted.lease.held).toBe(true);
    await expect(access(leaseFile)).resolves.toBeUndefined();

    // Control plane is live and serving over the composed socket.
    const client = await connectTestClient(booted.composed.socketPath, "cli");
    const ack = await client.handshake();
    expect(ack.accepted).toBe(true);
    client.close();

    await booted.shutdown();

    expect(booted.lease.held).toBe(false);
    // The lease file is removed (our record) — the next daemon can take over.
    await expect(access(leaseFile)).rejects.toThrow();
  });

  it("refuses a second daemon for the same project (single live instance)", async () => {
    booted = await bootSupervisor(baseConfig());

    await expect(bootSupervisor(baseConfig())).rejects.toBeInstanceOf(
      SupervisorAlreadyRunningError,
    );
  });

  it("gracefully shuts down on an injected signal, releasing the lease and de-registering handlers", async () => {
    const handlers = new Map<NodeJS.Signals, (signal: NodeJS.Signals) => void>();
    const shutdownSignals: (NodeJS.Signals | undefined)[] = [];

    booted = await bootSupervisor({
      ...baseConfig(),
      signals: ["SIGTERM"],
      registerSignal: (signal, handler) => handlers.set(signal, handler),
      unregisterSignal: (signal, handler) => {
        if (handlers.get(signal) === handler) handlers.delete(signal);
      },
      onShutdown: (info) => shutdownSignals.push(info.signal),
    });

    expect(handlers.has("SIGTERM")).toBe(true);

    // Fire the handler the way node would deliver the signal, then await the
    // (memoized) shutdown to completion.
    handlers.get("SIGTERM")?.("SIGTERM");
    await booted.shutdown();

    expect(shutdownSignals).toEqual(["SIGTERM"]);
    expect(booted.lease.held).toBe(false);
    expect(handlers.has("SIGTERM")).toBe(false);
  });

  it("boots with the process-default seams (real signal registration, env-derived lease dir)", async () => {
    // No leaseDir / signals / registerSignal / onShutdown injected — exercises
    // every default: resolveLeasesDir(env, hash), the SIGTERM+SIGINT default
    // set, the real process.on/off registration, and an explicit shutdown()
    // with no originating signal (the `{}` onShutdown-info branch). The real
    // handlers are removed by shutdown() before the test ends.
    // leaseOptions is also omitted, exercising the `?? {}` default (auto-renew
    // on, an unref'd heartbeat timer that shutdown() clears).
    booted = await bootSupervisor({
      env,
      projectHash: PROJECT_HASH,
      peerAuth: { reader: readPeerCredentialsLinux },
    });

    expect(booted.lease.held).toBe(true);
    expect(process.listeners("SIGTERM").length).toBeGreaterThan(0);

    await booted.shutdown();

    expect(booted.lease.held).toBe(false);
  });

  it("rethrows a non-lease-held acquisition failure unchanged", async () => {
    // A leaseDir whose parent is a regular file — Lease.acquire's mkdir fails
    // with ENOTDIR, which is NOT a LeaseHeldError and must propagate raw
    // rather than be reshaped into SupervisorAlreadyRunningError.
    const blocker = join(root, "blocker");
    await writeFile(blocker, "not a directory");

    const attempt = bootSupervisor({
      ...baseConfig(),
      leaseDir: join(blocker, "leases"),
    });

    await expect(attempt).rejects.toThrow();
    await expect(attempt).rejects.not.toBeInstanceOf(SupervisorAlreadyRunningError);
  });

  it("releases the lease if composition fails, so the project is not left wedged", async () => {
    await expect(
      bootSupervisor({
        ...baseConfig(),
        compose: () => Promise.reject(new Error("compose boom")),
      }),
    ).rejects.toThrow("compose boom");

    // The lease must have been released — a real boot immediately afterwards
    // succeeds rather than tripping the single-instance guard.
    booted = await bootSupervisor(baseConfig());
    expect(booted.lease.held).toBe(true);
  });
});
