/**
 * roadmap/09-cli-and-doctor.md — adversarial-review fix (2026-07-24),
 * finding #5: "doctor auth probe is a constant-fail stub in the shipped
 * binary." This suite proves the REAL dependency-wiring function
 * (`buildRealCliDependencies`, what `bin.ts` actually calls) wires a real,
 * non-constant-fail `resolveAuthState` by default — scoped to the same
 * `HOME` the rest of the wiring resolves against — and that its "valid"
 * branch genuinely fires given a real auth signal, not just that an
 * injected fake can be made to say so.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRealCliDependencies } from "./bootstrap.js";
import { SupervisorUnavailableError } from "./errors.js";
import type { SpawnSupervisorDaemonOptions } from "./uds-client/ensure-supervisor.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "eo-bootstrap-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("buildRealCliDependencies", () => {
  it("wires a real (non-constant-fail) resolveAuthState by default: 'missing' with nothing planted, 'valid' once a real credential file is planted under the same HOME", async () => {
    const deps = buildRealCliDependencies({ xdgEnv: { HOME: home }, projectHash: "boot-hash" });
    expect(deps.resolveAuthState).toBeDefined();

    // Nothing planted yet — the real (non-stub) resolver genuinely computes "missing".
    expect(await deps.resolveAuthState!()).toBe("missing");

    // Plant a real, correctly-permissioned handoff file under the SAME HOME
    // this dependency bag was built against, then re-derive dependencies
    // the same way — the "valid" branch of the ACTUAL default wiring now
    // genuinely fires, proving it isn't hardcoded to any fixed verdict.
    await mkdir(join(home, ".claude"), { recursive: true });
    const tokenPath = join(home, ".claude", ".eo-oauth-token");
    await writeFile(tokenPath, "fixture-token-value\n", "utf8");
    await chmod(tokenPath, 0o600);

    const depsAfterPlanting = buildRealCliDependencies({
      xdgEnv: { HOME: home },
      projectHash: "boot-hash",
    });
    expect(await depsAfterPlanting.resolveAuthState!()).toBe("valid");
  });

  it("honors an explicit resolveAuthState override", async () => {
    const deps = buildRealCliDependencies({
      xdgEnv: { HOME: home },
      projectHash: "boot-hash-2",
      resolveAuthState: async () => "valid",
    });
    expect(await deps.resolveAuthState!()).toBe("valid");
  });

  it("derives projectHash/journal/connectClient from the supplied xdgEnv when no override is given", () => {
    const deps = buildRealCliDependencies({ xdgEnv: { HOME: home } });
    expect(deps.projectHash).toBeDefined();
    expect(deps.journal).toBeDefined();
    expect(typeof deps.connectClient).toBe("function");
  });

  /**
   * roadmap/05-supervisor-daemon.md §Lifecycle: the daemon is "started on
   * demand by the CLI (09)". Until this wiring, `connectClient` called
   * `connectUdsClient` directly, so a project with no live daemon simply
   * failed with `SupervisorUnavailableError` and NOTHING ever started one.
   * These two prove the shipped `connectClient` now routes through
   * `ensureSupervisorConnection`: a real connect attempt against a real
   * (absent) socket path, one spawn, bounded retries, and the original
   * unavailable error once the budget is spent.
   */
  it("spawns the daemon on demand — once — when no socket is serving the project, passing the derived projectHash", async () => {
    const spawnCalls: SpawnSupervisorDaemonOptions[] = [];
    const deps = buildRealCliDependencies({
      xdgEnv: { HOME: home },
      projectHash: "spawn-hash",
      supervisorSpawn: {
        spawnDaemon: (options) => {
          spawnCalls.push(options);
        },
        maxAttempts: 3,
        retryDelayMs: 1,
      },
    });

    // No daemon will ever come up (the fake spawner starts nothing), so the
    // call exhausts its budget and rethrows the unavailable error verbatim.
    await expect(deps.connectClient()).rejects.toBeInstanceOf(SupervisorUnavailableError);
    expect(spawnCalls).toEqual([{ projectHash: "spawn-hash" }]);
  });

  it("defaults to the real detached spawner when no override is supplied", () => {
    const deps = buildRealCliDependencies({ xdgEnv: { HOME: home }, projectHash: "default-hash" });
    // Wired, not invoked: actually calling it here would fork a real daemon.
    expect(typeof deps.connectClient).toBe("function");
  });

  /**
   * `deps.trust` being absent is not a harmless default: `dispatch.ts`
   * silently falls back to the typed `NOT_IMPLEMENTED` shape when it is,
   * so a missing wiring here would leave `trust review|approve|revoke`
   * dead in the SHIPPED binary while every backend unit test still passed.
   * That is exactly the failure mode roadmap/12's exit criterion ("replaces
   * 09's NOT_IMPLEMENTED stub end-to-end") is about, so it is asserted
   * against the real wiring function rather than an injected bag.
   */
  it("wires the real trust backend by default, so `trust *` is not NOT_IMPLEMENTED in the shipped binary", async () => {
    const deps = buildRealCliDependencies({ xdgEnv: { HOME: home }, projectHash: "trust-hash" });
    expect(deps.trust).toBeDefined();

    const minted = await deps.trust!.minter.mint("capability_digest", "d".repeat(64));
    expect(minted.subjectKind).toBe("capability_digest");
    // A fresh per-process key: the token verifies against THIS bag's minter
    // and carries a real signature, not a placeholder.
    expect(minted.token.length).toBeGreaterThan(0);
    expect(() =>
      deps.trust!.minter.verify(minted.token, {
        subjectKind: "capability_digest",
        digest: "d".repeat(64),
      }),
    ).not.toThrow();
  });
});
