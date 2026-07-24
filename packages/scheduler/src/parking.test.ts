import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createJournalStore,
  getLatestAttempt,
  recordAttempt,
  type JournalStore,
} from "@eo/journal";
import {
  assertNotGloballyPaused,
  GLOBAL_PAUSE_SUBJECT_ID,
  getLatestParkTimer,
  getParkStatus,
  isGloballyPaused,
  isPastReset,
  parkWorkUnit,
  RATE_LIMIT_PARK_TIMER_DECISION,
} from "./parking.js";
import { GlobalPauseActiveError } from "./errors.js";

const WORK_UNIT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-scheduler-parking-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("isPastReset", () => {
  it("is false before the reset time and true at/after it", () => {
    expect(isPastReset(1000, 999)).toBe(false);
    expect(isPastReset(1000, 1000)).toBe(true);
    expect(isPastReset(1000, 1001)).toBe(true);
  });
});

describe("parkWorkUnit", () => {
  it("records a work_unit_transition('parked:rate_limit') retaining the sessionId", async () => {
    await recordAttempt(store, WORK_UNIT_ID, SESSION_ID, "dispatched");
    await parkWorkUnit({
      journal: store,
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      resetsAt: 5000,
    });

    const latest = await getLatestAttempt(store, WORK_UNIT_ID);
    expect(latest?.status).toBe("parked:rate_limit");
    expect(latest?.sessionId).toBe(SESSION_ID);
  });

  it("records a journal-derived park timer readable via getLatestParkTimer", async () => {
    await parkWorkUnit({
      journal: store,
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      resetsAt: 5000,
    });
    const timer = await getLatestParkTimer(store, WORK_UNIT_ID);
    expect(timer).toEqual({ workUnitId: WORK_UNIT_ID, sessionId: SESSION_ID, resetsAt: 5000 });
  });

  it("getLatestParkTimer ignores unrelated journal entry types, unrelated decisions, and other subjects' timers", async () => {
    const OTHER_WORK_UNIT_ID = "33333333-3333-4333-8333-333333333333";
    // An unrelated work_unit_transition entry (different type entirely).
    await recordAttempt(store, WORK_UNIT_ID, SESSION_ID, "dispatched");
    // An unrelated adjudication_decision (not a park timer at all).
    await store.appendEntry({
      type: "adjudication_decision",
      workUnitId: WORK_UNIT_ID,
      payload: { decision: "allow", rationale: "some unrelated tool-call adjudication" },
    });
    // A park timer for a DIFFERENT work unit — must not leak across subjects.
    await parkWorkUnit({
      journal: store,
      workUnitId: OTHER_WORK_UNIT_ID,
      sessionId: SESSION_ID,
      resetsAt: 1234,
    });
    // The real timer for WORK_UNIT_ID.
    await parkWorkUnit({
      journal: store,
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      resetsAt: 5000,
    });

    expect(await getLatestParkTimer(store, WORK_UNIT_ID)).toEqual({
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      resetsAt: 5000,
    });
    expect(await getLatestParkTimer(store, OTHER_WORK_UNIT_ID)).toEqual({
      workUnitId: OTHER_WORK_UNIT_ID,
      sessionId: SESSION_ID,
      resetsAt: 1234,
    });
  });

  it("MINOR-4 regression: getLatestParkTimer never throws an untyped SyntaxError for a malformed rationale carrying the park-timer sentinel decision — it treats it as 'no valid timer' instead", async () => {
    // A foreign/corrupted adjudication_decision entry that happens to carry
    // the exact park-timer sentinel `decision` value, but whose `rationale`
    // is NOT valid JSON at all — "never trust file content."
    await store.appendEntry({
      type: "adjudication_decision",
      workUnitId: WORK_UNIT_ID,
      payload: {
        decision: RATE_LIMIT_PARK_TIMER_DECISION,
        rationale: "this is not valid JSON at all {{{",
        subjectId: WORK_UNIT_ID,
      },
    });

    await expect(getLatestParkTimer(store, WORK_UNIT_ID)).resolves.toBeUndefined();
  });

  it("MINOR-4 regression: getLatestParkTimer never throws for a park-timer-sentinel entry whose rationale is valid JSON but the WRONG shape", async () => {
    await store.appendEntry({
      type: "adjudication_decision",
      workUnitId: WORK_UNIT_ID,
      payload: {
        decision: RATE_LIMIT_PARK_TIMER_DECISION,
        rationale: JSON.stringify({ unrelated: "shape", noResetsAtField: true }),
        subjectId: WORK_UNIT_ID,
      },
    });

    await expect(getLatestParkTimer(store, WORK_UNIT_ID)).resolves.toBeUndefined();
  });

  it("MINOR-4 regression: a malformed park-timer entry does not crash getParkStatus/isGloballyPaused — it is treated as though no valid timer exists", async () => {
    await recordAttempt(store, WORK_UNIT_ID, SESSION_ID, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_ID, "parked:rate_limit");
    await store.appendEntry({
      type: "adjudication_decision",
      workUnitId: WORK_UNIT_ID,
      payload: {
        decision: RATE_LIMIT_PARK_TIMER_DECISION,
        rationale: "not json",
        subjectId: WORK_UNIT_ID,
      },
    });

    // Falls back to the defensive "parked-but-timer-unknown" shape rather
    // than throwing — matches the pre-existing "no matching timer marker"
    // defensive branch.
    await expect(getParkStatus(store, WORK_UNIT_ID, 9999)).resolves.toEqual({
      parked: true,
      readyToResume: false,
      sessionId: SESSION_ID,
    });

    await store.appendEntry({
      type: "adjudication_decision",
      workUnitId: GLOBAL_PAUSE_SUBJECT_ID,
      payload: {
        decision: RATE_LIMIT_PARK_TIMER_DECISION,
        rationale: "also not json",
        subjectId: GLOBAL_PAUSE_SUBJECT_ID,
      },
    });
    await expect(isGloballyPaused(store, 9999)).resolves.toBe(false);
  });

  it("does not record a global timer unless accountWide is set", async () => {
    await parkWorkUnit({
      journal: store,
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      resetsAt: 5000,
    });
    expect(await getLatestParkTimer(store, GLOBAL_PAUSE_SUBJECT_ID)).toBeUndefined();
  });

  it("accountWide:true additionally records a global park timer", async () => {
    await parkWorkUnit({
      journal: store,
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      resetsAt: 5000,
      accountWide: true,
    });
    expect(await getLatestParkTimer(store, GLOBAL_PAUSE_SUBJECT_ID)).toEqual({
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      resetsAt: 5000,
    });
  });
});

describe("assertNotGloballyPaused", () => {
  it("MINOR-3: does not throw when no global pause is active", async () => {
    await expect(assertNotGloballyPaused(store, 10_000)).resolves.toBeUndefined();
  });

  it("MINOR-3: throws GlobalPauseActiveError while an account-wide pause is active", async () => {
    await parkWorkUnit({
      journal: store,
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      resetsAt: 5000,
      accountWide: true,
    });
    await expect(assertNotGloballyPaused(store, 4000)).rejects.toThrow(GlobalPauseActiveError);
    try {
      await assertNotGloballyPaused(store, 4000);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(GlobalPauseActiveError);
      expect((err as GlobalPauseActiveError).resetsAt).toBe(5000);
    }
  });

  it("MINOR-3: does not throw once the simulated clock passes the global reset", async () => {
    await parkWorkUnit({
      journal: store,
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      resetsAt: 5000,
      accountWide: true,
    });
    await expect(assertNotGloballyPaused(store, 5000)).resolves.toBeUndefined();
    await expect(assertNotGloballyPaused(store, 6000)).resolves.toBeUndefined();
  });
});

describe("isGloballyPaused", () => {
  it("is false with no global timer recorded", async () => {
    expect(await isGloballyPaused(store, 10_000)).toBe(false);
  });

  it("is true before the global reset, false after", async () => {
    await parkWorkUnit({
      journal: store,
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      resetsAt: 5000,
      accountWide: true,
    });
    expect(await isGloballyPaused(store, 4000)).toBe(true);
    expect(await isGloballyPaused(store, 5000)).toBe(false);
    expect(await isGloballyPaused(store, 6000)).toBe(false);
  });
});

describe("getParkStatus — restart-safe journal-derived read-back", () => {
  it("reports not-parked for a unit with no attempt history at all", async () => {
    expect(await getParkStatus(store, WORK_UNIT_ID, 10_000)).toEqual({
      parked: false,
      readyToResume: false,
    });
  });

  it("defensively reports parked-but-timer-unknown if a 'parked:rate_limit' attempt was recorded WITHOUT a matching timer marker (should be unreachable via parkWorkUnit itself, but guarded)", async () => {
    await recordAttempt(store, WORK_UNIT_ID, SESSION_ID, "dispatched");
    // Directly record the status transition WITHOUT going through
    // parkWorkUnit (which always writes both records together) — exercises
    // the defensive branch.
    await recordAttempt(store, WORK_UNIT_ID, SESSION_ID, "parked:rate_limit");

    const status = await getParkStatus(store, WORK_UNIT_ID, 9999);
    expect(status).toEqual({ parked: true, readyToResume: false, sessionId: SESSION_ID });
  });

  it("reports parked + not-yet-ready before the reset", async () => {
    await recordAttempt(store, WORK_UNIT_ID, SESSION_ID, "dispatched");
    await parkWorkUnit({
      journal: store,
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      resetsAt: 5000,
    });

    const status = await getParkStatus(store, WORK_UNIT_ID, 4000);
    expect(status.parked).toBe(true);
    expect(status.readyToResume).toBe(false);
    expect(status.sessionId).toBe(SESSION_ID);
    expect(status.resetsAt).toBe(5000);
  });

  it("reports parked + ready-to-resume once the simulated clock passes the reset", async () => {
    await recordAttempt(store, WORK_UNIT_ID, SESSION_ID, "dispatched");
    await parkWorkUnit({
      journal: store,
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      resetsAt: 5000,
    });

    const status = await getParkStatus(store, WORK_UNIT_ID, 5001);
    expect(status.parked).toBe(true);
    expect(status.readyToResume).toBe(true);
  });

  it("reports not-parked once the unit has been resumed and re-dispatched past the park", async () => {
    await recordAttempt(store, WORK_UNIT_ID, SESSION_ID, "dispatched");
    await parkWorkUnit({
      journal: store,
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      resetsAt: 5000,
    });
    // Simulated resume: same session_id, back to dispatched.
    await recordAttempt(store, WORK_UNIT_ID, SESSION_ID, "dispatched");

    const status = await getParkStatus(store, WORK_UNIT_ID, 9999);
    expect(status.parked).toBe(false);
    expect(status.readyToResume).toBe(false);
  });

  it("survives a simulated supervisor restart: a FRESH JournalStore instance over the same journalDir sees identical park status", async () => {
    await recordAttempt(store, WORK_UNIT_ID, SESSION_ID, "dispatched");
    await parkWorkUnit({
      journal: store,
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      resetsAt: 5000,
    });

    // Simulate a supervisor restart: brand-new JournalStore instance, same
    // on-disk journalDir, zero in-memory state carried over.
    const freshStore = createJournalStore({ journalDir });
    const status = await getParkStatus(freshStore, WORK_UNIT_ID, 5001);
    expect(status).toEqual({
      parked: true,
      readyToResume: true,
      sessionId: SESSION_ID,
      resetsAt: 5000,
    });
  });
});
