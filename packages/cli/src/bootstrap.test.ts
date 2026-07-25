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
import {
  ApprovalTokenAlreadyVerifiedError,
  ApprovalTokenSignatureError,
  ChangeSetSchema,
  type ChangeSet,
} from "@eo/contracts";
import { resolveStateRoot } from "@eo/journal";
import { CHANGE_SETS_FILE_NAME, createFileRegistry } from "@eo/supervisor";
import { buildChangeSet } from "@eo/testkit";
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
    // The token verifies against THIS bag's minter and carries a real
    // signature, not a placeholder.
    expect(minted.token.length).toBeGreaterThan(0);
    expect(() =>
      deps.trust!.minter.verify(minted.token, {
        subjectKind: "capability_digest",
        digest: "d".repeat(64),
      }),
    ).not.toThrow();
  });

  /**
   * The reason `./approval/signing-key.ts` exists. Every approval token in
   * this system is minted by one short-lived process (`eo run`, `eo trust
   * approve`) and verified by a DIFFERENT one — `contract.approve` is
   * served from the long-lived `gateway mcp` stdio server. While the
   * signing key was a per-process `randomBytes(32)`, that cross-process
   * verify could never succeed, so any tool wired onto it would be a
   * registered-but-dead surface. Two independently-built bags stand in for
   * the two processes here.
   *
   * Single-use is NOT what this proves and is not weakened by it: replay
   * protection is enforced durably, independent of the key's lifetime —
   * which is exactly what the assertion below pins. A second process
   * presenting an already-claimed token must be rejected as a REPLAY
   * (`ApprovalTokenAlreadyVerifiedError`), never as a bad signature: the
   * signature-error branch is what a per-process key produced, and is the
   * regression this test exists to catch.
   */
  it("signs with the project's DURABLE key — a second process rejects a token as a replay, not as a bad signature", async () => {
    const mintingProcess = buildRealCliDependencies({
      xdgEnv: { HOME: home },
      projectHash: "cross-process-hash",
    });
    const minted = await mintingProcess.trust!.minter.mint("capability_digest", "e".repeat(64));

    const verifyingProcess = buildRealCliDependencies({
      xdgEnv: { HOME: home },
      projectHash: "cross-process-hash",
    });

    expect(() =>
      verifyingProcess.trust!.minter.verify(minted.token, {
        subjectKind: "capability_digest",
        digest: "e".repeat(64),
      }),
    ).toThrow(ApprovalTokenAlreadyVerifiedError);
  });

  /**
   * The key is project-scoped: another project's minter holds different key
   * material, so the token fails at the SIGNATURE — the precise error the
   * same-project case above must never produce.
   */
  it("scopes the signing key per project — another project rejects the token's signature", async () => {
    const projectA = buildRealCliDependencies({
      xdgEnv: { HOME: home },
      projectHash: "project-a",
    });
    const minted = await projectA.trust!.minter.mint("capability_digest", "f".repeat(64));

    const projectB = buildRealCliDependencies({
      xdgEnv: { HOME: home },
      projectHash: "project-b",
    });

    expect(() =>
      projectB.trust!.minter.verify(minted.token, {
        subjectKind: "capability_digest",
        digest: "f".repeat(64),
      }),
    ).toThrow(ApprovalTokenSignatureError);
  });

  /**
   * Same failure mode as the `trust` case above, plus a durability one: the
   * repository must be the FILE-backed store, because `connection add` and
   * `connection list` are separate processes. Wiring the in-memory store
   * here would pass every unit test and still lose every connection an
   * operator added.
   */
  it("wires the real, DURABLE connection backend by default — a connection added in one process survives into the next", async () => {
    const deps = buildRealCliDependencies({ xdgEnv: { HOME: home }, projectHash: "conn-hash" });
    expect(deps.connection).toBeDefined();

    const created = await deps.connection!.repository.create({
      provider: "jira",
      baseUrl: "https://example.atlassian.net",
      allowedRedirectOrigins: ["https://example.atlassian.net"],
      allowedResources: [],
      allowedActions: [],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "JIRA_TOKEN" },
    });

    // A SECOND bag built exactly as the next CLI invocation would build it,
    // against the same HOME — the connection must still be there.
    const nextInvocation = buildRealCliDependencies({
      xdgEnv: { HOME: home },
      projectHash: "conn-hash",
    });
    expect(await nextInvocation.connection!.repository.get(created.id)).toEqual(created);
  });

  /**
   * The bug this pins was total: intake registries were in-memory, and
   * journal replay rebuilds only runs/workers, so an approved DAG died with
   * the `run` invocation that produced it. The supervisor daemon — a
   * DIFFERENT process — could therefore never see a DAG to drive, which is
   * why `driveRun` had no production caller that could possibly work.
   *
   * Asserting through `composeSupervisor`'s own exported file-name
   * constants is deliberate: if either side ever renames its path, the two
   * processes stop sharing state and this fails, rather than silently
   * regressing to "the daemon sees nothing".
   */
  it("persists intake artifacts where the supervisor daemon reads them, so an approved DAG outlives the CLI process", () => {
    const deps = buildRealCliDependencies({ xdgEnv: { HOME: home }, projectHash: "intake-hash" });
    expect(deps.intake).toBeDefined();

    const changeSet = buildChangeSet({ id: "33333333-3333-4333-8333-333333333333" });
    deps.intake!.changeSets.put(changeSet);

    // Read back exactly as the daemon does: a fresh file registry over the
    // path composeSupervisor resolves, not the CLI's own object.
    const daemonView = createFileRegistry<ChangeSet>({
      path: join(resolveStateRoot({ HOME: home }, "intake-hash"), CHANGE_SETS_FILE_NAME),
      schema: ChangeSetSchema,
    });
    expect(daemonView.get(changeSet.id)).toEqual(changeSet);
  });

  it("shares ONE approval-token minter between trust and run, so both subject kinds verify in-process", async () => {
    const deps = buildRealCliDependencies({ xdgEnv: { HOME: home }, projectHash: "minter-hash" });
    // Same instance, not merely equivalent: two minters would each hold a
    // distinct signing key and single-use table.
    expect(deps.intake!.minter).toBe(deps.trust!.minter);

    const envelopeToken = await deps.intake!.minter.mint("envelope_hash", "e".repeat(64));
    expect(() =>
      deps.trust!.minter.verify(envelopeToken.token, {
        subjectKind: "envelope_hash",
        digest: "e".repeat(64),
      }),
    ).not.toThrow();
  });
});
