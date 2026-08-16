import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, TimestampSchema } from "../shared/ids.js";
import {
  COMMAND_EVIDENCE_CLASS,
  GrantableCommandPrefixSchema,
  type GrantableCommandPrefix,
} from "./envelope-policy.js";
import type { Requirement } from "./requirement.js";

/**
 * `AcceptanceEvaluationRecord` — what an attempt actually RAN, as opposed to
 * what its worker said about itself. Owner ruling R5 (2026-08-16).
 *
 * WHY IT EXISTS. Two runs reached `published_local` — the strongest state this
 * system has — on a worker's unchecked self-report. Run `04a0bf70` self-reported
 * `{"outcome":"succeeded","summary":"test"}` after twelve `Bash` calls that all
 * failed to start; run `bc167a3a` reported honestly, in its own result record,
 * that the suite never ran. Both published.
 * `docs/evidence/phase-25/published-unverified.md` is the measurement, and the
 * ruling it earned is that a run whose acceptance criteria were never evaluated
 * must not publish, and must NAME what went unverified rather than fail bare.
 *
 * Naming needs material, and this record is it. `WorkerResult` cannot be that
 * material: every field a worker authors is a field a worker can be induced to
 * author differently, and the guard would then be checking a claim against
 * itself. What the harness observes independently is the ENGINE's tool-use
 * stream — which commands were invoked, and whether the tool call errored.
 *
 * ⚠️ THE HONEST BOUND, stated here rather than left for a reviewer to find.
 * A clean `npm run test` establishes that the criteria were EVALUATED. It does
 * not establish that they were evaluated ADEQUATELY: a suite can be filtered, a
 * test can assert nothing, and this record cannot tell the difference. R5's
 * refusal closes the "nothing checked anything" hole, which is the one that was
 * measured; scoring the evaluation's own quality is phase 14's coverage/tdd
 * tranche and R6's per-change bound, neither of which this claims to be.
 *
 * A second bound, narrower: `cleanExits` counts tool calls the ENGINE reported
 * as not-errored. The harness is not the process that ran the command, so this
 * is the engine's report about its own tool call rather than an independently
 * observed exit status. It is the strongest signal available at this seam, and
 * it is not worker-authored — which is the property that matters.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY: the command STRING. `toolInput.command`
 * is worker-authored and therefore attacker-controlled on exactly this path, and
 * this record is journaled. Every invocation is folded onto the closed
 * `GrantableCommandPrefix` vocabulary before it is written, so the entry carries
 * an enum member and two counts — never prose. That is the same rule
 * `journalSealRefusal` states for its own payload ("ids and hashes only").
 */

/** One grantable prefix, and what the attempt did with it. */
export const CommandInvocationTallySchema = z
  .object({
    prefix: GrantableCommandPrefixSchema,
    /** How many times the worker invoked a command under this grant. */
    invocations: z.number().int().min(1),
    /**
     * How many of those the engine reported as not-errored.
     *
     * Kept ALONGSIDE `invocations` rather than replacing it, because the
     * difference is the actionable part of the refusal: twelve invocations and
     * zero clean exits says the command path is broken, and zero invocations
     * says the worker never tried. An operator does different things about each.
     */
    cleanExits: z.number().int().min(0),
  })
  .strict()
  .refine((tally) => tally.cleanExits <= tally.invocations, {
    message: "cleanExits cannot exceed invocations",
  });

export type CommandInvocationTally = z.infer<typeof CommandInvocationTallySchema>;

export const AcceptanceEvaluationRecordSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    changeSetId: IdSchema,
    workUnitId: IdSchema,
    /** The engine session this was observed on — so a record traces to a transcript. */
    sessionId: IdSchema,
    /**
     * The requirements THIS attempt was scoped to, copied from its `TaskPacket`.
     *
     * Carried on the record rather than resolved by the reader, because the
     * gate's question is per-requirement and the packet is gone by the time it
     * fires. An empty list is legitimate — a chore unit owns no requirement —
     * and contributes coverage for nothing rather than for everything.
     */
    requirementIds: z.array(IdSchema),
    /**
     * One entry per DISTINCT grant the worker invoked, in `GRANTABLE_COMMAND_
     * PREFIXES` order. A prefix the worker never invoked is ABSENT, not a zero
     * row: "never attempted" and "attempted and never worked" are the two
     * diagnoses this record exists to separate, and an implicit zero would
     * merge them.
     */
    invocations: z.array(CommandInvocationTallySchema),
    observedAt: TimestampSchema,
  })
  .strict();

export type AcceptanceEvaluationRecord = z.infer<typeof AcceptanceEvaluationRecordSchema>;

/**
 * Whether one record is evidence that its requirements were evaluated.
 *
 * True only for a grant classed `acceptance` (`COMMAND_EVIDENCE_CLASS`) that ran
 * clean at least once. `npm run build` exiting clean is deliberately NOT enough:
 * that is precisely run `bc167a3a`, which R5 exists to refuse.
 */
export function isEvaluationEvidence(record: AcceptanceEvaluationRecord): boolean {
  return record.invocations.some(
    (tally) => COMMAND_EVIDENCE_CLASS[tally.prefix] === "acceptance" && tally.cleanExits > 0,
  );
}

/**
 * The records that still SPEAK for each work unit — its latest engine session's,
 * and no earlier attempt's.
 *
 * ⚠️ WHY NOT SIMPLY THE UNION OF EVERY RECORD. A repair attempt is a fresh engine
 * session run against CHANGED code. A clean suite in the attempt it replaced says
 * nothing about the code that actually shipped, so a plain union would let a
 * repair publish on its predecessor's verification — attempt one runs the tests
 * and fails for some other reason, attempt two rewrites the code, runs nothing,
 * reports success, and publishes. That is the same class of hole R5 exists to
 * close, one attempt deep.
 *
 * WHY SESSION AND NOT RECORD RECENCY. A rate-limit park and its resume are the
 * SAME session — `EngineAdapter.resume` carries `sessionRef.sessionId` through
 * unchanged — so a suite that ran before a park is still a run against the code
 * that shipped, and the park's own record must not supersede it. Keying on the
 * latest RECORD would discard it; keying on the latest SESSION keeps exactly the
 * segments that belong to the attempt that ended the unit's life.
 *
 * Append order is the journal's documented contract, so "last seen" is "latest".
 */
export function currentAttemptRecords(
  records: readonly AcceptanceEvaluationRecord[],
  changeSetId: string,
): readonly AcceptanceEvaluationRecord[] {
  const scoped = records.filter((record) => record.changeSetId === changeSetId);
  const latestSessionByUnit = new Map<string, string>();
  for (const record of scoped) latestSessionByUnit.set(record.workUnitId, record.sessionId);
  return scoped.filter((record) => latestSessionByUnit.get(record.workUnitId) === record.sessionId);
}

/** One requirement that no record evaluated, with the criteria that went unchecked. */
export interface UnevaluatedRequirement {
  readonly requirementId: string;
  readonly title: string;
  readonly acceptanceCriteria: readonly string[];
}

/**
 * The requirements in `requirements` that no record in `records` evaluated.
 *
 * FAIL-CLOSED IN EVERY DIRECTION, which is the whole point: a requirement with
 * no record at all, a record belonging to another change set, a record covering
 * other requirements, a record superseded by a later attempt on the same work
 * unit, and a record whose only clean exits were `integrity` or `inspection`
 * commands all leave the requirement unevaluated. There is no input shaped like
 * "assume it was fine".
 *
 * Returns them in `requirements` order so a refusal reads in the order the
 * contract declares, not in journal order.
 */
export function unevaluatedRequirements(
  requirements: readonly Requirement[],
  records: readonly AcceptanceEvaluationRecord[],
  changeSetId: string,
): readonly UnevaluatedRequirement[] {
  const evaluated = new Set<string>();
  for (const record of currentAttemptRecords(records, changeSetId)) {
    if (!isEvaluationEvidence(record)) continue;
    for (const id of record.requirementIds) evaluated.add(id);
  }
  return requirements
    .filter((requirement) => !evaluated.has(requirement.id))
    .map((requirement) => ({
      requirementId: requirement.id,
      title: requirement.title,
      acceptanceCriteria: requirement.acceptanceCriteria,
    }));
}

/**
 * What each work unit was observed doing, rendered for the operator channel.
 *
 * The half of the refusal that says what to DO about it. A unit with no record
 * is named as such — an attempt that never reached the executor's result branch
 * observed nothing, and reporting silence as "ran nothing" would be a claim this
 * has no basis for.
 *
 * SUPERSEDED records are listed and LABELLED rather than dropped. Dropping them
 * would hide the most confusing case an operator can meet — a repair that
 * published nothing because its predecessor did the verifying — and printing them
 * unlabelled would be worse still: a refusal reading "npm run test 1x, 1 clean"
 * beside "these criteria were never evaluated" reads as a contradiction.
 */
export function describeObservations(
  records: readonly AcceptanceEvaluationRecord[],
  changeSetId: string,
): readonly string[] {
  const current = new Set(currentAttemptRecords(records, changeSetId));
  return records
    .filter((record) => record.changeSetId === changeSetId)
    .map((record) => {
      const tallies =
        record.invocations.length === 0
          ? "no granted command was invoked"
          : record.invocations
              .map(
                (tally) =>
                  `${tally.prefix} (${COMMAND_EVIDENCE_CLASS[tally.prefix]}) invoked ${String(
                    tally.invocations,
                  )}x, ${String(tally.cleanExits)} clean`,
              )
              .join(", ");
      const superseded = current.has(record) ? "" : " [superseded by a later attempt]";
      return `work unit ${record.workUnitId}: ${tallies}${superseded}`;
    });
}

/** The grants that would satisfy the gate, for a refusal that says what to run. */
export const ACCEPTANCE_EVIDENCE_PREFIXES: readonly GrantableCommandPrefix[] = Object.freeze(
  (Object.keys(COMMAND_EVIDENCE_CLASS) as GrantableCommandPrefix[]).filter(
    (prefix) => COMMAND_EVIDENCE_CLASS[prefix] === "acceptance",
  ),
);
