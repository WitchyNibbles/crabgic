import { randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, exitCriteriaFor, type PipelineStageId } from "@crabgic/contracts";
import { runReviewSubmit, type ReviewSubmitResult } from "./review-submit-handler.js";
import { loadFindings, saveFindings } from "./finding-store.js";

/**
 * Submits a live reviewer's verdict through `review.submit` and returns what the
 * SERVER decided — roadmap/25, the live-round harness.
 *
 * WHY THIS EXISTS. The first live round (2026-08-15) dispatched real reviewers
 * and found five blocking defects, but the manager read their findings and
 * decided what to do. That leaves the strongest claim unproven: that closure is
 * the server's and not the caller's. A round whose verdict a human interprets is
 * a round where the human is the judge, whatever the code says.
 *
 * So this transcribes rather than interprets. It takes a reviewer's structured
 * verdict verbatim, hands it to the real handler against the real on-disk
 * finding store, and returns the handler's answer. It contains no rule about
 * whether a stage may close, and it must not gain one: the whole point is that
 * `stageClosable` comes back from `runReviewSubmit`.
 *
 * ⚠️ WHAT IT IS NOT. This is a harness for an owner-authorized live round, not a
 * production surface. Production submits through the gateway's `review.submit`
 * tool, and this deliberately shares that handler rather than reimplementing it
 * — a second submission path would be a second closure rule to keep in step.
 */

/** The shape a live reviewer returns, as the lens prompts specify it. */
export interface LiveReviewerVerdict {
  readonly lens: string;
  readonly verdict: "approve" | "revise";
  readonly answeredObligations: readonly string[];
  readonly findings: readonly {
    readonly claim: string;
    readonly paths: readonly string[];
    readonly classification: "blocking" | "advisory";
    readonly violates?: string;
    readonly evidence: {
      readonly reproduction: string;
      readonly observed: string;
      readonly expected: string;
    };
  }[];
}

export interface LiveRoundInput {
  readonly stage: PipelineStageId;
  readonly round: number;
  readonly artifactRef: string;
  readonly plannedWritePaths: readonly string[];
  readonly findingStorePath: string;
  readonly stateHome: string;
  readonly reviewer: LiveReviewerVerdict;
}

/**
 * A reviewer's finding carries no disposition — it has just been raised, and
 * `raised → verified → classified → dispositioned` is a walk, not a leap. The
 * harness marks each as `fixed` ONLY when the caller has actually fixed it,
 * which is why `disposition` is a parameter rather than a default: a harness
 * that dispositioned findings on the reviewer's behalf would be answering the
 * reviewer's own findings for it.
 */
export async function submitLiveRound(
  input: LiveRoundInput,
  disposition?: {
    readonly value: "fixed" | "refuted" | "accepted-debt";
    readonly evidence: string;
  },
): Promise<ReviewSubmitResult> {
  const prior = await loadFindings(input.findingStorePath);

  const findings = input.reviewer.findings.map((raw) => ({
    id: randomUUID(),
    claim: raw.claim,
    evidence: raw.evidence,
    verification: "confirmed" as const,
    classification: raw.classification,
    ...(raw.violates !== undefined ? { violates: raw.violates } : {}),
    ...(disposition !== undefined
      ? { disposition: disposition.value, dispositionEvidence: disposition.evidence }
      : {}),
    paths: [...raw.paths],
  }));

  const result = await runReviewSubmit(
    {
      stage: input.stage,
      verdict: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        stage: input.stage,
        artifactRef: input.artifactRef,
        lens: input.reviewer.lens,
        verdict: input.reviewer.verdict,
        round: input.round,
        findings,
      },
    },
    {
      appendEvidence: () => Promise.resolve(),
      priorFindings: () => prior,
      plannedWrites: () => input.plannedWritePaths,
      /**
       * The obligations the reviewer says it answered, intersected with what the
       * stage actually requires. A reviewer claiming an obligation the stage
       * never issued is not evidence of coverage, and passing its list through
       * unfiltered would let a reviewer widen its own checklist.
       */
      metCriteria: () =>
        input.reviewer.answeredObligations.filter((obligation) =>
          exitCriteriaFor(input.stage).includes(obligation),
        ),
      calibration: () => ({
        calibrated: false,
        kappa: 0,
        kappaLowerBound: 0,
        sampleSize: 0,
        samplesNeeded: 50,
        verdictReason: "no owner-labelled corpus exists for this project yet",
      }),
    },
  );

  if (result.ok && result.findings !== undefined) {
    await saveFindings(input.findingStorePath, result.findings, input.stateHome);
  }
  return result;
}
