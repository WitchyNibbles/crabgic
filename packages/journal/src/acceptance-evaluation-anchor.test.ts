import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AcceptanceEvaluationRecord } from "@crabgic/contracts";
import { createJournalStore, type JournalStore } from "./store/journal-store.js";
import {
  ACCEPTANCE_EVALUATION_DECISION,
  findAcceptanceEvaluations,
  journalAcceptanceEvaluation,
} from "./acceptance-evaluation-anchor.js";

const CHANGE_SET = "11111111-1111-4111-8111-111111111111";
const OTHER_CHANGE_SET = "22222222-2222-4222-8222-222222222222";
const UNIT_A = "33333333-3333-4333-8333-333333333333";
const UNIT_B = "44444444-4444-4444-8444-444444444444";
const RUN = "55555555-5555-4555-8555-555555555555";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-journal-acceptance-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function record(overrides: Partial<AcceptanceEvaluationRecord> = {}): AcceptanceEvaluationRecord {
  return {
    schemaVersion: 1,
    changeSetId: CHANGE_SET,
    workUnitId: UNIT_A,
    sessionId: "66666666-6666-4666-8666-666666666666",
    requirementIds: [],
    invocations: [{ prefix: "npm run test", invocations: 2, cleanExits: 1 }],
    observedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("the acceptance-evaluation journal anchor", () => {
  it("round-trips a record through the append-only journal", async () => {
    await journalAcceptanceEvaluation(store, record());
    expect(await findAcceptanceEvaluations(store, CHANGE_SET)).toStrictEqual([record()]);
  });

  it("rides on adjudication_decision under its own discriminator, never a fourteenth entry type", async () => {
    await journalAcceptanceEvaluation(store, record(), RUN);

    const entries: { readonly decision: string; readonly rationale: string }[] = [];
    for await (const entry of store.queryEntries({ type: "adjudication_decision" })) {
      if (entry.type !== "adjudication_decision") continue;
      entries.push({ decision: entry.payload.decision, rationale: entry.payload.rationale });
    }
    expect(entries).toHaveLength(1);
    expect(entries[0]?.decision).toBe(ACCEPTANCE_EVALUATION_DECISION);
    // The rationale is DERIVED from the record's own counts — no worker prose
    // reaches the permanent, append-only journal on this path.
    expect(entries[0]?.rationale).toBe(
      "observed 2 granted command invocation(s), 1 clean, across 1 distinct grant(s)",
    );
  });

  /**
   * Records ACCUMULATE, unlike the criteria seal beside them, which supersedes by
   * recency. An observation is a fact about something that already happened, and
   * the gate's question is about the union of them.
   */
  it("returns every record for the change set, in append order", async () => {
    await journalAcceptanceEvaluation(store, record({ workUnitId: UNIT_A }));
    await journalAcceptanceEvaluation(store, record({ workUnitId: UNIT_B }));

    const found = await findAcceptanceEvaluations(store, CHANGE_SET);
    expect(found.map((entry) => entry.workUnitId)).toStrictEqual([UNIT_A, UNIT_B]);
  });

  it("does not return another change set's records", async () => {
    await journalAcceptanceEvaluation(store, record({ changeSetId: OTHER_CHANGE_SET }));
    expect(await findAcceptanceEvaluations(store, CHANGE_SET)).toStrictEqual([]);
  });

  /**
   * A record naming another change set inside an entry ADDRESSED to this one
   * would let one run's verification satisfy another run's publish gate. The
   * reader re-checks the payload for exactly that reason, so this asserts the
   * second check rather than the envelope filter that already passed.
   */
  it("ignores a record whose payload names a different change set from its entry", async () => {
    await store.appendEntry({
      type: "adjudication_decision",
      changeSetId: CHANGE_SET,
      workUnitId: UNIT_A,
      payload: {
        decision: ACCEPTANCE_EVALUATION_DECISION,
        rationale: "forged",
        subjectId: UNIT_A,
        acceptanceEvaluation: record({ changeSetId: OTHER_CHANGE_SET }),
      },
    });
    expect(await findAcceptanceEvaluations(store, CHANGE_SET)).toStrictEqual([]);
  });

  it("ignores adjudication entries that carry no acceptance evaluation at all", async () => {
    await store.appendEntry({
      type: "adjudication_decision",
      changeSetId: CHANGE_SET,
      payload: { decision: "criteria_sealed", rationale: "unrelated", subjectId: CHANGE_SET },
    });
    expect(await findAcceptanceEvaluations(store, CHANGE_SET)).toStrictEqual([]);
  });

  it("returns an empty list for a change set with no records — the input every reader must treat as NOT verified", async () => {
    expect(await findAcceptanceEvaluations(store, CHANGE_SET)).toStrictEqual([]);
  });
});
