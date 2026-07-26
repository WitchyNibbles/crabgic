/**
 * Composition-root wiring — roadmap/05-supervisor-daemon.md §Lifecycle
 * ("started on demand by the CLI (09); exactly one live instance per
 * project") + §"Before this phase ... nothing owns a process, a socket, or
 * a worker; after it, 06 has a real spawn target, 09 has a live protocol to
 * speak." Phase 23 final-wiring pass (roadmap/09 Risks: "whoever lands 16,
 * or 23's final wiring pass, must settle the actual composition point").
 *
 * `composeSupervisor` is that composition point: it news up the journal, the
 * five registries, the (initially empty) `liveWorkers` map, runs startup
 * recovery + orphan reaping from the journal, builds the router, and starts
 * the UDS control plane — the single place that turns 05's library units
 * into a live daemon `startSupervisorServer`/`buildSupervisorRouter` have
 * never actually been called from before this phase.
 *
 * These tests exercise the wiring against a real UDS socket in a tmp
 * `$XDG_STATE_HOME`, exactly as this package's own `uds-server.concurrent.
 * test.ts` does — never a mock server.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, resolveJournalDir, type XdgEnv } from "@crabgic/journal";
import { buildChangeSet } from "@crabgic/testkit";
import { createRunsRegistry } from "../registries/runs-registry.js";
import { readPeerCredentialsLinux } from "../peer-auth/peer-credentials.js";
import { transitionRun } from "../run-lifecycle/run-transition.js";
import { connectTestClient } from "../socket/test-support/supervisor-test-client.js";
import { composeSupervisor, type ComposedSupervisor } from "./compose-supervisor.js";

const RUN_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_HASH = "composehash0001";

let root: string;
let env: XdgEnv;
let composed: ComposedSupervisor | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-supervisor-compose-"));
  env = { HOME: root, XDG_STATE_HOME: join(root, "state") };
});

afterEach(async () => {
  await composed?.close();
  composed = undefined;
  await rm(root, { recursive: true, force: true });
});

describe("composeSupervisor — the daemon composition root", () => {
  it("constructs journal + registries + router and starts a live UDS control plane", async () => {
    composed = await composeSupervisor({
      env,
      projectHash: PROJECT_HASH,
      peerAuth: { reader: readPeerCredentialsLinux },
    });

    // The socket path is env-derived — the same one the CLI (09) resolves.
    expect(composed.socketPath).toContain(PROJECT_HASH);
    expect(composed.socketPath.endsWith("control.sock")).toBe(true);

    const client = await connectTestClient(composed.socketPath, "cli");
    const ack = await client.handshake();
    expect(ack.accepted).toBe(true);

    // A query against a never-seen run resolves to "unknown", not a throw —
    // proving the router is wired to a real (empty) runs registry.
    const status = await client.request("run.status", { runId: RUN_ID });
    expect(status.ok).toBe(true);
    expect((status.result as { run?: unknown }).run).toBeUndefined();

    client.close();
  });

  it("recovers prior run state from the journal at startup", async () => {
    // Seed a durable run_transition into the journal BEFORE the daemon boots,
    // simulating a run that existed across a supervisor restart. The in-memory
    // registries are never persisted, so the ONLY way the fresh daemon can
    // know this run exists is by replaying the journal.
    const journalDir = resolveJournalDir(env, PROJECT_HASH);
    const seedJournal = createJournalStore({ journalDir });
    const changeSet = buildChangeSet();
    await transitionRun({
      journal: seedJournal,
      runs: createRunsRegistry(),
      runId: RUN_ID,
      changeSetId: changeSet.id,
      to: "awaiting_approval",
    });

    composed = await composeSupervisor({
      env,
      projectHash: PROJECT_HASH,
      peerAuth: { reader: readPeerCredentialsLinux },
    });

    const client = await connectTestClient(composed.socketPath, "cli");
    await client.handshake();
    const status = await client.request("run.status", { runId: RUN_ID });
    client.close();

    expect(status.ok).toBe(true);
    const run = (
      status.result as { run?: { runId: string; runState: string; changeSetId: string } }
    ).run;
    expect(run).toBeDefined();
    expect(run?.runId).toBe(RUN_ID);
    expect(run?.runState).toBe("awaiting_approval");
    expect(run?.changeSetId).toBe(changeSet.id);
  });

  it("recovers a crashed worker from the journal and reaps it at startup, firing the orphan hook", async () => {
    // A run that had a worker mid-flight when the prior daemon died: a
    // run_transition + a session_assignment with NO terminal work-unit
    // transition. Replay must resurrect the run AND synthesize a crashed
    // worker, which the startup orphan sweep then formally reaps.
    const journalDir = resolveJournalDir(env, PROJECT_HASH);
    const seedJournal = createJournalStore({ journalDir });
    const changeSet = buildChangeSet();
    const workUnitId = "33333333-3333-4333-8333-333333333333";
    const sessionId = "44444444-4444-4444-8444-444444444444";
    await transitionRun({
      journal: seedJournal,
      runs: createRunsRegistry(),
      runId: RUN_ID,
      changeSetId: changeSet.id,
      to: "awaiting_approval",
    });
    await seedJournal.appendEntry({
      type: "session_assignment",
      runId: RUN_ID,
      workUnitId,
      payload: { sessionId },
    });

    const orphanHookCalls: string[] = [];
    const connectionErrors: Error[] = [];
    composed = await composeSupervisor({
      env,
      projectHash: PROJECT_HASH,
      peerAuth: { reader: readPeerCredentialsLinux },
      onOrphanDetected: (worker) => {
        orphanHookCalls.push(worker.sessionId);
      },
      onConnectionError: (err) => {
        connectionErrors.push(err);
      },
    });

    expect(composed.recoveredRunIds).toContain(RUN_ID);
    expect(composed.reapedWorkerIds.length).toBeGreaterThan(0);
    expect(orphanHookCalls).toContain(sessionId);
    expect(connectionErrors).toEqual([]);

    // The recovered run is still queryable over the live control plane.
    const client = await connectTestClient(composed.socketPath, "cli");
    await client.handshake();
    const status = await client.request("run.status", { runId: RUN_ID });
    client.close();
    expect((status.result as { run?: { runState: string } }).run?.runState).toBe(
      "awaiting_approval",
    );
  });

  it("exposes the constructed dependencies for the execution driver to share", async () => {
    composed = await composeSupervisor({
      env,
      projectHash: PROJECT_HASH,
      peerAuth: { reader: readPeerCredentialsLinux },
    });

    // The execution driver (slice D) must dispatch against the SAME registries
    // the control plane serves — one shared instance, never a second copy.
    expect(composed.deps.runs.list()).toEqual([]);
    expect(composed.deps.liveWorkers.size).toBe(0);
    expect(typeof composed.deps.journal.appendEntry).toBe("function");
  });
});
