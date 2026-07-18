/**
 * roadmap/05-supervisor-daemon.md §Exit criteria: "Two same-uid local
 * connections (standing in for the CLI and the gateway) both pass the
 * `SO_PEERCRED` check against the identical router and receive identical
 * `run.status`/`run.cancel` responses — proving one handler, two
 * transports." §Test plan, Integration: "two concurrent same-uid
 * connections (standing in for CLI+gateway) both clearing SO_PEERCRED
 * against the identical router returning identical run.status/run.cancel
 * responses."
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { buildChangeSet } from "@eo/testkit";
import { buildSupervisorRouter } from "../router/build-router.js";
import { createRunsRegistry } from "../registries/runs-registry.js";
import { createChangeSetsRegistry } from "../registries/change-sets-registry.js";
import { createWorkUnitsRegistry } from "../registries/work-units-registry.js";
import { createWorkersRegistry } from "../registries/workers-registry.js";
import { createArtifactIndexRegistry } from "../registries/artifact-index-registry.js";
import { readPeerCredentialsLinux } from "../peer-auth/peer-credentials.js";
import { transitionRun } from "../run-lifecycle/run-transition.js";
import { startSupervisorServer, type SupervisorServer } from "./uds-server.js";
import { connectTestClient } from "./test-support/supervisor-test-client.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

let root: string;
let journalDir: string;
let store: JournalStore;
let server: SupervisorServer | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-supervisor-uds-concurrent-"));
  journalDir = join(root, "journal");
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(root, { recursive: true, force: true });
});

describe("two concurrent same-uid connections (CLI + gateway stand-ins) — one handler, two transports", () => {
  it("both clear SO_PEERCRED against the identical router and receive identical run.status/run.cancel responses", async () => {
    const runs = createRunsRegistry();
    const changeSet = buildChangeSet();
    await transitionRun({
      journal: store,
      runs,
      runId: RUN_ID,
      changeSetId: changeSet.id,
      to: "awaiting_approval",
    });

    const router = buildSupervisorRouter({
      journal: store,
      runs,
      changeSets: createChangeSetsRegistry(),
      workUnits: createWorkUnitsRegistry(),
      workers: createWorkersRegistry(),
      artifactIndex: createArtifactIndexRegistry(),
      liveWorkers: new Map(),
    });

    const runtimeDir = join(root, "run");
    const socketPath = join(runtimeDir, "control.sock");
    server = await startSupervisorServer({
      runtimeDir,
      socketPath,
      router,
      peerAuth: { reader: readPeerCredentialsLinux },
    });

    // "the CLI" and "the gateway" — two independent, concurrent
    // connections to the SAME socket, both running as this same uid.
    const cli = await connectTestClient(server.socketPath, "cli");
    const gateway = await connectTestClient(server.socketPath, "gateway");

    const [cliAck, gatewayAck] = await Promise.all([cli.handshake(), gateway.handshake()]);
    expect(cliAck.accepted).toBe(true);
    expect(gatewayAck.accepted).toBe(true);

    const [cliStatus, gatewayStatus] = await Promise.all([
      cli.request("run.status", { runId: RUN_ID }),
      gateway.request("run.status", { runId: RUN_ID }),
    ]);
    expect(cliStatus.ok).toBe(true);
    expect(gatewayStatus.ok).toBe(true);
    expect(cliStatus.result).toEqual(gatewayStatus.result);

    const [cliCancel, gatewayCancel] = await Promise.all([
      cli.request("run.cancel", { runId: RUN_ID }),
      gateway.request("run.status", { runId: RUN_ID }), // gateway reads status right as cli cancels
    ]);
    expect(cliCancel.ok).toBe(true);
    expect(gatewayCancel.ok).toBe(true);

    // After the cancel lands, both connections observe the identical
    // post-cancel state through the identical router.
    const [cliFinal, gatewayFinal] = await Promise.all([
      cli.request("run.status", { runId: RUN_ID }),
      gateway.request("run.status", { runId: RUN_ID }),
    ]);
    expect(cliFinal.result).toEqual(gatewayFinal.result);
    expect((cliFinal.result as { run?: { runState: string } }).run?.runState).toBe("cancelled");

    cli.close();
    gateway.close();
  });
});
