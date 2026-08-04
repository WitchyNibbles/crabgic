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
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import {
  buildSupervisorRouter,
  createArtifactIndexRegistry,
  createRequirementsRegistry,
  createChangeSetsRegistry,
  createRunsRegistry,
  createWorkUnitsRegistry,
  createWorkersRegistry,
  readPeerCredentialsLinux,
  startSupervisorServer,
  type SupervisorServer,
} from "@crabgic/supervisor";
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
    requirements: createRequirementsRegistry(),
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
      {
        command: "status",
        runId: "11111111-1111-4111-8111-111111111111",
        watch: true,
        json: false,
      },
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

/**
 * `status <run-id>` reports PROGRESS, not just the run's lifecycle state.
 *
 * The state answers "is it going?"; an operator watching a multi-minute run
 * needs "how far has it got?", and the journal already held that. Wired here
 * rather than asserted only on the fold, because a pure function nothing calls
 * is the failure mode this repository has paid for before.
 */
describe("runStatusCommand — work-unit progress", () => {
  function depsWith(entries: readonly unknown[]): CliDependencies {
    return {
      projectHash: "test-hash",
      connectClient: () =>
        Promise.resolve({
          request: () =>
            Promise.resolve({
              run: {
                runId: "run-1",
                changeSetId: "cs-1",
                runState: "running",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            }),
          close: () => Promise.resolve(),
          onEvent: () => () => undefined,
        } as never),
      journal: {
        queryEntries: (() =>
          (async function* () {
            for (const entry of entries) yield entry;
          })()) as never,
        verifyJournal: (() => Promise.resolve({ ok: true, entries: 0 })) as never,
      },
    } as CliDependencies;
  }

  const transition = (workUnitId: string, status: string): unknown => ({
    type: "work_unit_transition",
    workUnitId,
    payload: { status },
  });

  it("renders a progress line under the run line", async () => {
    const result = await runStatusCommand(
      { command: "status", runId: "run-1", watch: false, json: false },
      depsWith([
        transition("wu-1", "succeeded"),
        transition("wu-2", "dispatched"),
        transition("wu-3", "failed"),
      ]),
    );

    expect(result.stdout).toContain("run run-1: running");
    expect(result.stdout).toContain("work units seen:");
    expect(result.stdout).toContain("1 succeeded");
    expect(result.stdout).toContain("1 running");
    expect(result.stdout).toContain("1 failed");
  });

  it("says nothing extra when the journal has seen no work units", async () => {
    const result = await runStatusCommand(
      { command: "status", runId: "run-1", watch: false, json: false },
      depsWith([]),
    );
    expect(result.stdout).toContain("run run-1: running");
    // "0 of 0" implies a denominator this cannot know; silence is honest.
    expect(result.stdout).not.toContain("work units seen");
  });

  it("leaves --json exactly as 05 published it, because that shape is a contract", async () => {
    // `./cli.commands.schema.test.ts` validates this output against the REAL
    // `RunStatusResultSchema`, which is `.strict()`: the CLI's status JSON "IS
    // literally 05's own published result, never re-shaped". Widening it is a
    // cross-phase interface decision the ledger governs, so a rendering
    // improvement must not smuggle a key in — and this pins that.
    const result = await runStatusCommand(
      { command: "status", runId: "run-1", watch: false, json: true },
      depsWith([transition("wu-1", "succeeded"), transition("wu-2", "failed")]),
    );

    const parsed = JSON.parse(result.stdout!) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["run"]);
    expect(parsed).not.toHaveProperty("progress");
  });
});
