import { describe, expect, it } from "vitest";
import { renderRunProgress, summarizeRunProgress, type ProgressJournal } from "./run-progress.js";

/** A journal that yields the given entries, and records the filter it was asked for. */
function journalOf(entries: readonly unknown[]): ProgressJournal & { readonly filters: unknown[] } {
  const filters: unknown[] = [];
  return {
    filters,
    queryEntries(filter) {
      filters.push(filter);
      return (async function* () {
        for (const entry of entries) yield entry;
      })();
    },
  };
}

function transition(workUnitId: string, status: string): unknown {
  return { type: "work_unit_transition", workUnitId, payload: { status } };
}

describe("summarizeRunProgress", () => {
  it("asks the journal only for this run's work-unit transitions", async () => {
    const journal = journalOf([]);
    await summarizeRunProgress(journal, "run-1");
    expect(journal.filters).toEqual([{ type: "work_unit_transition", runId: "run-1" }]);
  });

  it("reports the LATEST status per work unit, not every status it ever had", async () => {
    // The whole point of folding an append-only log: a unit that was dispatched
    // and then succeeded is succeeded, and must not be counted twice.
    const progress = await summarizeRunProgress(
      journalOf([
        transition("wu-1", "dispatched"),
        transition("wu-2", "dispatched"),
        transition("wu-1", "succeeded"),
      ]),
      "run-1",
    );

    expect(progress.seen).toBe(2);
    expect(progress.byWorkUnit.get("wu-1")).toBe("succeeded");
    expect(progress.byWorkUnit.get("wu-2")).toBe("dispatched");
    expect(progress.counts.get("succeeded")).toBe(1);
    expect(progress.counts.get("dispatched")).toBe(1);
  });

  it("counts a unit that failed after being dispatched as failed only", async () => {
    const progress = await summarizeRunProgress(
      journalOf([transition("wu-1", "dispatched"), transition("wu-1", "failed")]),
      "run-1",
    );
    expect(progress.seen).toBe(1);
    expect(progress.counts.get("failed")).toBe(1);
    expect(progress.counts.get("dispatched")).toBeUndefined();
  });

  it("ignores entries that are not shaped like a transition, rather than throwing", async () => {
    // The journal is a heterogeneous log; a progress view must never be the
    // thing that crashes `status` because an entry had an unexpected shape.
    const progress = await summarizeRunProgress(
      journalOf([
        {},
        { workUnitId: "wu-1" },
        { payload: { status: "succeeded" } },
        transition("wu-2", "succeeded"),
      ]),
      "run-1",
    );
    expect(progress.seen).toBe(1);
    expect(progress.byWorkUnit.get("wu-2")).toBe("succeeded");
  });

  it("returns an empty summary for a run with no transitions", async () => {
    const progress = await summarizeRunProgress(journalOf([]), "run-1");
    expect(progress.seen).toBe(0);
    expect(progress.counts.size).toBe(0);
  });
});

describe("renderRunProgress", () => {
  it("says nothing at all when the journal has seen no work units", async () => {
    // "0 of 0" is worse than silence: it implies a denominator this cannot know.
    const progress = await summarizeRunProgress(journalOf([]), "run-1");
    expect(renderRunProgress(progress)).toBeUndefined();
  });

  it("orders statuses so the bad news has a fixed position", async () => {
    const progress = await summarizeRunProgress(
      journalOf([
        transition("wu-1", "failed"),
        transition("wu-2", "succeeded"),
        transition("wu-3", "dispatched"),
        transition("wu-4", "parked:rate_limit"),
      ]),
      "run-1",
    );
    expect(renderRunProgress(progress)).toBe(
      "  work units seen: 1 succeeded · 1 running · 1 parked (rate limit) · 1 failed\n",
    );
  });

  it("calls `dispatched` running, because that is what an operator calls it", async () => {
    const progress = await summarizeRunProgress(journalOf([transition("wu-1", "dispatched")]), "r");
    expect(renderRunProgress(progress)).toContain("1 running");
  });

  it("reports an unknown status rather than silently dropping it", async () => {
    // A status this renderer has never heard of is exactly the thing worth
    // seeing — dropping it would make the counts quietly wrong.
    const progress = await summarizeRunProgress(
      journalOf([transition("wu-1", "succeeded"), transition("wu-2", "quarantined")]),
      "run-1",
    );
    const rendered = renderRunProgress(progress);
    expect(rendered).toContain("1 succeeded");
    expect(rendered).toContain("1 quarantined");
  });
});
