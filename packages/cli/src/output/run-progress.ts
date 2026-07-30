/**
 * Per-work-unit progress for a run, folded out of the journal.
 *
 * WHY THIS EXISTS. `crabgic status <run-id>` reported one line — the run's own
 * lifecycle state — which answers "is it going?" and not "how far has it got?".
 * For a run that takes minutes across several work units those are different
 * questions, and only the second one tells an operator whether to keep waiting.
 * Every competing orchestrator surfaces this; the data was already here.
 *
 * DERIVED, NEVER STORED. The journal is the record and this is a fold over it,
 * so a progress view can never disagree with what actually happened — there is
 * no second copy to drift. `work_unit_transition` entries are append-only and
 * ordered, so the LAST entry for a work unit is its current status.
 *
 * It reports what the journal knows, which is not the same as what the plan
 * contains: a work unit that has never been dispatched has no entry and cannot
 * be counted here. That is why the rendering says "seen" rather than implying a
 * total — a denominator this function cannot know would be a number that looks
 * authoritative and is not.
 */
import type { WorkUnitAttemptStatus } from "@crabgic/contracts";

/** The minimal journal shape this needs — a filtered async iterable of entries. */
export interface ProgressJournal {
  queryEntries(filter: {
    readonly type?: "work_unit_transition";
    readonly runId?: string;
  }): AsyncIterable<unknown>;
}

export interface RunProgress {
  /** Latest status per work unit, keyed by work-unit id. */
  readonly byWorkUnit: ReadonlyMap<string, WorkUnitAttemptStatus>;
  /** How many work units are at each status. */
  readonly counts: ReadonlyMap<WorkUnitAttemptStatus, number>;
  /** How many work units the journal has seen at all. */
  readonly seen: number;
  /**
   * What the run has spent, summed from the usage each terminal transition
   * carries.
   *
   * `costUsd` is `undefined` when NO attempt reported a cost — distinct from
   * `0`, which would claim the run was free. The engine does not always report
   * one, and inventing a zero would be the kind of confident wrong number this
   * whole view exists to avoid.
   */
  readonly turnsUsed: number;
  readonly costUsd: number | undefined;
}

/** Reads `payload.status` off an entry, or `undefined` if the entry is not shaped like a transition. */
function statusOf(entry: unknown): WorkUnitAttemptStatus | undefined {
  const candidate = entry as { readonly payload?: { readonly status?: unknown } };
  const status = candidate.payload?.status;
  return typeof status === "string" ? (status as WorkUnitAttemptStatus) : undefined;
}

/** Reads `payload.usage`, tolerating an entry that carries none or carries it malformed. */
function usageOf(entry: unknown): { turnsUsed: number; totalCostUsd?: number } | undefined {
  const usage = (entry as { readonly payload?: { readonly usage?: unknown } }).payload?.usage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const { turnsUsed, totalCostUsd } = usage as {
    turnsUsed?: unknown;
    totalCostUsd?: unknown;
  };
  if (typeof turnsUsed !== "number" || !Number.isFinite(turnsUsed)) return undefined;
  return {
    turnsUsed,
    ...(typeof totalCostUsd === "number" && Number.isFinite(totalCostUsd) ? { totalCostUsd } : {}),
  };
}

function workUnitIdOf(entry: unknown): string | undefined {
  const candidate = entry as { readonly workUnitId?: unknown };
  return typeof candidate.workUnitId === "string" ? candidate.workUnitId : undefined;
}

/**
 * Folds a run's `work_unit_transition` entries into its current progress.
 *
 * Later entries overwrite earlier ones per work unit, which is what makes this
 * "current status" rather than "every status it has ever had".
 */
export async function summarizeRunProgress(
  journal: ProgressJournal,
  runId: string,
): Promise<RunProgress> {
  const byWorkUnit = new Map<string, WorkUnitAttemptStatus>();
  // Usage is summed over EVERY transition that carried it, not over the latest
  // status per unit: a unit that failed twice and then succeeded cost all three
  // attempts, and a spend figure that forgot the failures would understate the
  // one thing an owner is watching.
  let turnsUsed = 0;
  let costUsd: number | undefined;
  for await (const entry of journal.queryEntries({ type: "work_unit_transition", runId })) {
    const workUnitId = workUnitIdOf(entry);
    const status = statusOf(entry);
    if (workUnitId === undefined || status === undefined) continue;
    byWorkUnit.set(workUnitId, status);

    const usage = usageOf(entry);
    if (usage === undefined) continue;
    turnsUsed += usage.turnsUsed;
    if (usage.totalCostUsd !== undefined) costUsd = (costUsd ?? 0) + usage.totalCostUsd;
  }

  const counts = new Map<WorkUnitAttemptStatus, number>();
  for (const status of byWorkUnit.values()) {
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return { byWorkUnit, counts, seen: byWorkUnit.size, turnsUsed, costUsd };
}

/**
 * The order statuses are shown in: what is finished, what is moving, what is
 * stuck. An operator scanning this wants the bad news to have a fixed position
 * rather than to move around as counts change.
 */
const STATUS_ORDER: readonly WorkUnitAttemptStatus[] = [
  "succeeded",
  "dispatched",
  "parked:rate_limit",
  "failed",
];

/** Human labels — `dispatched` is the journal's word for it, "running" is the operator's. */
const STATUS_LABEL: Readonly<Record<string, string>> = {
  succeeded: "succeeded",
  dispatched: "running",
  "parked:rate_limit": "parked (rate limit)",
  failed: "failed",
};

/**
 * One line of progress, or `undefined` when the journal has seen no work units
 * for this run — in which case saying nothing is better than "0 of 0".
 */
export function renderRunProgress(progress: RunProgress): string | undefined {
  if (progress.seen === 0) return undefined;

  const parts: string[] = [];
  for (const status of STATUS_ORDER) {
    const count = progress.counts.get(status);
    if (count !== undefined && count > 0) {
      parts.push(`${String(count)} ${STATUS_LABEL[status] ?? status}`);
    }
  }
  // Any status the ordering above does not name still gets reported rather than
  // silently dropped: an unknown status is exactly the thing worth seeing.
  for (const [status, count] of progress.counts) {
    if (!STATUS_ORDER.includes(status)) parts.push(`${String(count)} ${status}`);
  }

  const spend: string[] = [];
  if (progress.turnsUsed > 0) spend.push(`${String(progress.turnsUsed)} turns`);
  // `undefined` cost is not zero: the engine did not report one, and printing
  // "$0.00" would claim the run was free.
  if (progress.costUsd !== undefined) spend.push(`$${progress.costUsd.toFixed(2)}`);

  return (
    `  work units seen: ${parts.join(" · ")}\n` +
    (spend.length > 0 ? `  spent so far:    ${spend.join(" · ")}\n` : "")
  );
}
