import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, getLatestAttempt, type JournalStore } from "@eo/journal";
import { reapOrphansAtStartup } from "./orphan-reaper.js";
import { createWorkersRegistry } from "../registries/workers-registry.js";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-supervisor-orphan-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

const WORK_UNIT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

describe("reapOrphansAtStartup", () => {
  it("journals a failed attempt and marks a non-terminal worker crashed", async () => {
    const workers = createWorkersRegistry();
    workers.upsert({
      workerId: "w1",
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      status: "running",
      startedAt: "2026-07-18T00:00:00.000Z",
    });

    const reapedIds = await reapOrphansAtStartup({ journal: store, workers });

    expect(reapedIds).toEqual(["w1"]);
    expect(workers.get("w1")?.status).toBe("crashed");

    const attempt = await getLatestAttempt(store, WORK_UNIT_ID);
    expect(attempt?.status).toBe("failed");
    expect(attempt?.sessionId).toBe(SESSION_ID);
  });

  it("invokes the recovery-hook call site for each reaped orphan", async () => {
    const workers = createWorkersRegistry();
    workers.upsert({
      workerId: "w1",
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      status: "starting",
      startedAt: "2026-07-18T00:00:00.000Z",
    });

    const seen: string[] = [];
    await reapOrphansAtStartup({
      journal: store,
      workers,
      onOrphanDetected: (worker) => {
        seen.push(worker.workerId);
      },
    });

    expect(seen).toEqual(["w1"]);
  });

  it("does nothing for an empty WorkersRegistry — no throw", async () => {
    const workers = createWorkersRegistry();
    await expect(reapOrphansAtStartup({ journal: store, workers })).resolves.toEqual([]);
  });

  it("leaves an already-terminated worker untouched", async () => {
    const workers = createWorkersRegistry();
    workers.upsert({
      workerId: "w1",
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      status: "terminated",
      startedAt: "2026-07-18T00:00:00.000Z",
      terminatedAt: "2026-07-18T00:05:00.000Z",
    });

    const reapedIds = await reapOrphansAtStartup({ journal: store, workers });
    expect(reapedIds).toEqual([]);
    expect(workers.get("w1")?.status).toBe("terminated");
  });
});
