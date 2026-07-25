import { z } from "zod";
import type { JournalStore } from "@eo/journal";

/**
 * Monotonic coverage-ratchet store — roadmap/14 §In scope, "Coverage"
 * bullet: "ratchet state journaled and monotonic"; §Interfaces produced:
 * "Coverage ratchet store — persists the monotonic coverage floor per
 * project." `JournalEntryType` is closed at exactly 13 members
 * (interface-ledger Gap 5) and no dedicated member exists for a ratchet
 * update — this module reuses `adjudication_decision`'s already-generic
 * payload, the SAME documented precedent `@eo/scheduler`'s `parking.ts`/
 * `shadow-run.ts`/`attempt-policy.ts` already establish for exactly this
 * situation (their own file-level doc comments cite it explicitly). See the
 * phase-14 evidence doc's deviations section.
 *
 * ORDER-INDEPENDENCE (roadmap/14 §Test plan, "Property"): the floor at any
 * point is the componentwise MAX over every observation ever recorded FOR
 * THE SAME PROJECT — for ANY permutation of the same set of historical
 * observations, replaying them (in any order) against a fresh store yields
 * the identical final floor. `./ratchet.property.test.ts` proves this via
 * fast-check. This also makes "an existing project never regresses below
 * its recorded floor" trivially hold: a regression never raises the max, so
 * it can never lower it either — the floor is monotonic non-decreasing BY
 * CONSTRUCTION, never by a separate "don't decrease" branch.
 *
 * PROJECT SCOPING (MINOR-3, adversarial-validation round): every
 * observation carries a `projectId`, and every read filters by it — "the
 * monotonic coverage floor PER PROJECT" (this file's own §Interfaces-
 * produced citation above) is not automatic just because a `JournalStore`
 * is typically one-per-project in this system's own XDG layout (04); a
 * shared/aggregated journal, or a future caller passing the wrong store,
 * would otherwise let one project's ratchet history silently contaminate
 * another's (a brand-new project's genuinely-first, low observation being
 * misread as a "regression" against an unrelated project's already-high
 * floor). `projectId` is caller-supplied — the natural, already-existing
 * stable identifier is `ProjectProfile.id` (`@eo/contracts`), but this
 * module accepts any non-empty string so a caller without a resolved
 * `ProjectProfile` at hand can still supply a stable equivalent (documented
 * in `../coverage-gate.ts`'s own `CoverageGateInput.projectId` field).
 */

const RATCHET_DECISION = "coverage_ratchet_observation";

const RatchetObservationSchema = z
  .object({
    projectId: z.string().min(1),
    linePct: z.number().min(0).max(100),
    branchPct: z.number().min(0).max(100),
    observedAt: z.string(),
  })
  .strict();

export interface RatchetObservation {
  readonly projectId: string;
  readonly linePct: number;
  readonly branchPct: number;
  readonly observedAt: string;
}

export interface RatchetFloor {
  readonly linePct: number;
  readonly branchPct: number;
}

/** Guarded parse — never throws on malformed/foreign journal content (mirrors `@eo/scheduler`'s `parking.ts`/`attempt-policy.ts` MINOR-4 precedent: "never trust file content"). */
function parseObservation(rationale: string): RatchetObservation | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rationale);
  } catch {
    return undefined;
  }
  const result = RatchetObservationSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

async function readRatchetHistory(
  journal: JournalStore,
  projectId: string,
): Promise<readonly RatchetObservation[]> {
  const history: RatchetObservation[] = [];
  for await (const entry of journal.queryEntries({ type: "adjudication_decision" })) {
    if (entry.type !== "adjudication_decision") continue;
    if (entry.payload.decision !== RATCHET_DECISION) continue;
    const parsed = parseObservation(entry.payload.rationale);
    if (parsed !== undefined && parsed.projectId === projectId) {
      history.push(parsed);
    }
  }
  return history;
}

/** The current ratchet floor for `projectId` — the componentwise max of every observation ever recorded FOR THAT PROJECT, or `undefined` if none exist yet (a genuinely greenfield project). Never contaminated by another project's history sharing the same journal (MINOR-3). */
export async function getCoverageRatchetFloor(
  journal: JournalStore,
  projectId: string,
): Promise<RatchetFloor | undefined> {
  const history = await readRatchetHistory(journal, projectId);
  if (history.length === 0) return undefined;
  return {
    linePct: Math.max(...history.map((h) => h.linePct)),
    branchPct: Math.max(...history.map((h) => h.branchPct)),
  };
}

export interface RatchetRecordResult {
  readonly floorBefore: RatchetFloor | undefined;
  readonly floorAfter: RatchetFloor;
  /** `true` iff this observation fell below the PRIOR floor on either axis — the "recorded floor 82% -> new run 79%" blocking fixture. */
  readonly regressed: boolean;
}

/**
 * Records one coverage observation for `projectId`. Always appends (the
 * history itself is append-only — regressions are recorded too, so the
 * audit trail is complete), then reports whether THIS observation
 * regressed relative to the SAME PROJECT's floor as it stood immediately
 * before this call — never relative to a different project's floor, even
 * on a shared journal (MINOR-3).
 */
export async function recordCoverageObservation(
  journal: JournalStore,
  projectId: string,
  summary: { readonly linePct: number; readonly branchPct: number },
  now: () => Date = () => new Date(),
): Promise<RatchetRecordResult> {
  const floorBefore = await getCoverageRatchetFloor(journal, projectId);
  const regressed =
    floorBefore !== undefined &&
    (summary.linePct < floorBefore.linePct || summary.branchPct < floorBefore.branchPct);

  const observation: RatchetObservation = {
    projectId,
    linePct: summary.linePct,
    branchPct: summary.branchPct,
    observedAt: now().toISOString(),
  };
  await journal.appendEntry({
    type: "adjudication_decision",
    payload: {
      decision: RATCHET_DECISION,
      rationale: JSON.stringify(observation),
    },
  });

  const floorAfter = await getCoverageRatchetFloor(journal, projectId);
  if (floorAfter === undefined) {
    throw new Error("coverage ratchet: floor must exist immediately after recording an observation");
  }
  return { floorBefore, floorAfter, regressed };
}
