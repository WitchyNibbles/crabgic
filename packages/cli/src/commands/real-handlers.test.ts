/**
 * Unit coverage for `./real-handlers.ts` branches not already exercised by
 * `./dispatch.test.ts`'s real-supervisor integration suite: `status
 * --watch`'s event-streaming loop, and `doctor`'s human-mode rendering of a
 * failing check plus `--repair-plan`.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import {
  buildSupervisorRouter,
  createArtifactIndexRegistry,
  createChangeSetsRegistry,
  createRunsRegistry,
  createWorkUnitsRegistry,
  createWorkersRegistry,
  readPeerCredentialsLinux,
  startSupervisorServer,
  type SupervisorServer,
} from "@eo/supervisor";
import { EXIT_DOCTOR_FINDINGS, EXIT_OK } from "../exit-codes.js";
import { connectUdsClient } from "../uds-client/client.js";
import type { CliDependencies } from "./types.js";
import { runDoctorCommand, runStatusCommand } from "./real-handlers.js";

let root: string;
let journal: JournalStore;
let server: SupervisorServer | undefined;
let deps: CliDependencies;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-cli-real-handlers-"));
  journal = createJournalStore({ journalDir: join(root, "journal") });
  const router = buildSupervisorRouter({
    journal,
    runs: createRunsRegistry(),
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
  deps = {
    connectClient: () => connectUdsClient({ socketPath }),
    journal,
    projectHash: "hash",
  };
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(root, { recursive: true, force: true });
});

describe("runStatusCommand --watch", () => {
  it("emits the initial status line then resolves immediately given an already-aborted signal", async () => {
    const lines: string[] = [];
    const controller = new AbortController();
    controller.abort();
    const result = await runStatusCommand(
      { command: "status", runId: "11111111-1111-4111-8111-111111111111", watch: true, json: false },
      deps,
      { watchSignal: controller.signal, emitLine: (line) => lines.push(line) },
    );
    expect(result.exitCode).toBe(EXIT_OK);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toContain("unknown");
  });

  it("resolves once the signal aborts asynchronously, having emitted the initial line", async () => {
    const lines: string[] = [];
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const result = await runStatusCommand(
      { command: "status", runId: "11111111-1111-4111-8111-111111111111", watch: true, json: true },
      deps,
      {
        watchSignal: controller.signal,
        emitLine: (line) => lines.push(line),
      },
    );
    expect(result.exitCode).toBe(EXIT_OK);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(result.stdout!)).toEqual({});
  });
});

describe("runDoctorCommand", () => {
  it("human mode renders a failing check with a ✗ marker and, with --repair-plan, an ordered repair plan", async () => {
    const result = await runDoctorCommand(
      { command: "doctor", repairPlan: true, json: false },
      { ...deps, resolveAuthState: () => Promise.resolve("missing") },
    );
    expect(result.exitCode).toBe(EXIT_DOCTOR_FINDINGS);
    expect(result.stdout).toContain("✗");
    expect(result.stdout).toContain("Repair plan");
  });

  it("human mode without --repair-plan omits the repair-plan section even when checks fail", async () => {
    const result = await runDoctorCommand(
      { command: "doctor", repairPlan: false, json: false },
      { ...deps, resolveAuthState: () => Promise.resolve("missing") },
    );
    expect(result.stdout).not.toContain("Repair plan");
  });

  it("--json with --repair-plan includes a repairPlan array", async () => {
    const result = await runDoctorCommand(
      { command: "doctor", repairPlan: true, json: true },
      { ...deps, resolveAuthState: () => Promise.resolve("missing") },
    );
    const parsed = JSON.parse(result.stdout!) as { repairPlan?: readonly string[] };
    expect(Array.isArray(parsed.repairPlan)).toBe(true);
  });
});
