import type { IdempotencyRegistry } from "@crabgic/journal";

/**
 * A minimal, in-memory stand-in for "an external mutation a worker's
 * attempt performs" (e.g. a Jira transition, a Grafana alert-rule write —
 * this harness's own scope is 05/13 only, so it models the SHAPE of the
 * exactly-once problem generically rather than depending on 16/18/20's real
 * connector pipeline). `applications` records one entry per side effect
 * actually applied — a crash-then-repair arc that duplicates the side
 * effect leaves TWO entries for the same `operationId`; a correctly
 * exactly-once arc leaves exactly ONE.
 */
export interface SideEffectSink {
  readonly applications: string[];
}

export function createSideEffectSink(): SideEffectSink {
  return { applications: [] };
}

/** How many times `operationId` was actually applied to `sink` — the harness's own duplication-detection primitive. */
export function countApplications(sink: SideEffectSink, operationId: string): number {
  return sink.applications.filter((id) => id === operationId).length;
}

/**
 * THE NAIVE / VULNERABLE PATH — unconditionally applies the side effect
 * every time it's called, with no de-duplication whatsoever. This is
 * deliberately kept in this harness (never deleted) as the seeded
 * counter-example roadmap/23 work item 4's own fail-first criterion names:
 * "harness FAILs on a seeded duplicated side effect from a forced worker
 * crash." A crash-then-repair arc that applies the side effect via THIS
 * function on both the original attempt and the repair produces two
 * entries for the same `operationId` — see
 * `../test/duplicated-side-effect-fail-first.test.ts`.
 */
export function applySideEffectNaive(sink: SideEffectSink, operationId: string): void {
  sink.applications.push(operationId);
}

export type ApplyOutcome = "applied" | "replayed";

/**
 * THE CORRECT / EXACTLY-ONCE PATH — gates the side effect behind `@crabgic/
 * journal`'s real `IdempotencyRegistry.checkOrRecord` (04's own primitive;
 * never reimplemented here). A repair attempt for the SAME `operationId` +
 * `contentHash` (e.g. the same `WorkUnit` id + the same packet content
 * hash) replays the FIRST call's recorded outcome instead of re-executing
 * `sink.applications.push`, so a crash-then-repair arc never applies the
 * side effect more than once — restart-safe, since `IdempotencyRegistry`'s
 * own persistence is the journal, not this function's own memory.
 */
export async function applySideEffectExactlyOnce(
  sink: SideEffectSink,
  idempotency: IdempotencyRegistry,
  operationId: string,
  contentHash: string,
): Promise<ApplyOutcome> {
  const outcome = await idempotency.checkOrRecord(operationId, contentHash, () => {
    sink.applications.push(operationId);
    return sink.applications.length;
  });
  return outcome.status === "recorded" ? "applied" : "replayed";
}
