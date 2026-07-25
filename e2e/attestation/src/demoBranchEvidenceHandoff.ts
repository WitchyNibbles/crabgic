import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { buildCheckResult, type AttestationCheckResult } from "./checkResult.js";

/**
 * `demo-branch-evidence-handoff` — roadmap/23 Exit criteria: "A verified
 * neutral local branch with concise commits and evidence-backed handoff
 * produced by the demo run — the branch plus its evidence bundle (rendered
 * PR-title/PR-body/review-comment artifacts retrievable via
 * `evidence <change-set-id>`), never an opened PR (Gap 6, by design)."
 *
 * Five obligations, each independently checkable against the demo run's
 * own record:
 *
 *   1. NEUTRAL — no development-engine attribution in the branch name or
 *      in any commit subject/body. This is 08/17's neutrality invariant
 *      re-asserted at the release cut.
 *   2. LOCAL, NEVER PUSHED — zero remote interactions.
 *   3. NEVER AN OPENED PR — Gap 6 is a design decision, so an opened PR is
 *      a violation even if everything else is perfect.
 *   4. CONCISE COMMITS — at least one commit, and every subject within the
 *      conventional 72-character limit.
 *   5. EVIDENCE-BACKED HANDOFF — a non-empty evidence bundle whose every
 *      artifact actually resolves.
 *
 * Plus the report's umbrella clause: the branch must have been produced
 * from the exact release-candidate object ID.
 */
export const DEMO_RUN_RECORD_PATH = "docs/evidence/phase-23/demo-run.json";

/** Maximum conventional git subject length — the "concise commits" clause. */
export const MAX_COMMIT_SUBJECT_LENGTH = 72;

/**
 * Development-engine attribution tokens. Deliberately the same family of
 * markers 08's publication routine and 17's blocking lint already refuse;
 * restated here as literals to keep this project's dependency edge narrow,
 * exactly as `e2e/report/src/checklist.ts` does for its gate tags.
 */
export const ATTRIBUTION_MARKERS = [
  "claude",
  "anthropic",
  "co-authored-by:",
  "generated with",
  "opus",
  "sonnet",
] as const;

export function findAttributionMarkers(text: string): readonly string[] {
  const lower = text.toLowerCase();
  return ATTRIBUTION_MARKERS.filter((marker) => lower.includes(marker));
}

export const DemoCommitSchema = z
  .object({ subject: z.string(), body: z.string().default("") })
  .strict();

export const DemoRunRecordSchema = z
  .object({
    branchName: z.string().min(1),
    /** The object ID the demo run was produced from. */
    objectId: z.string().min(1),
    commits: z.array(DemoCommitSchema),
    /** Repo-relative paths of the rendered PR-title/PR-body/review-comment artifacts. */
    evidenceBundle: z.array(z.string().min(1)),
    /** Count of remote Git interactions the run performed. Must be 0. */
    remoteInteractions: z.number().int().nonnegative(),
    /** Whether a PR was opened. Must be false — Gap 6, by design. */
    pullRequestOpened: z.boolean(),
  })
  .strict();
export type DemoRunRecord = z.infer<typeof DemoRunRecordSchema>;

export interface CheckDemoBranchEvidenceHandoffInput {
  readonly releaseCandidateObjectId: string;
  readonly record: DemoRunRecord | undefined;
  readonly pathExists: (repoRelativePath: string) => boolean;
}

export function checkDemoBranchEvidenceHandoff(
  input: CheckDemoBranchEvidenceHandoffInput,
): AttestationCheckResult {
  if (input.record === undefined) {
    return buildCheckResult([
      `no demo run recorded for the release candidate (expected ${DEMO_RUN_RECORD_PATH}) — ` +
        "the demo-run exit criterion is unsatisfied, not vacuously met.",
    ]);
  }

  const record = input.record;
  const reasons: string[] = [];
  const details: string[] = [`branch ${record.branchName} from ${record.objectId}`];

  const branchMarkers = findAttributionMarkers(record.branchName);
  if (branchMarkers.length > 0) {
    reasons.push(
      `branch name "${record.branchName}" carries development-engine attribution: ${branchMarkers.join(", ")}.`,
    );
  }

  if (record.objectId !== input.releaseCandidateObjectId) {
    reasons.push(
      `demo branch was produced from ${record.objectId}, not the release candidate ${input.releaseCandidateObjectId}.`,
    );
  }

  if (record.remoteInteractions !== 0) {
    reasons.push(
      `${record.remoteInteractions} remote Git interaction(s) occurred — the demo run must be local-only.`,
    );
  }

  if (record.pullRequestOpened) {
    reasons.push("a pull request was opened — Gap 6 requires the branch and bundle, never a PR.");
  }

  if (record.commits.length === 0) {
    reasons.push("the demo branch carries no commits.");
  }
  record.commits.forEach((commit, index) => {
    if (commit.subject.length > MAX_COMMIT_SUBJECT_LENGTH) {
      reasons.push(
        `commit ${index + 1} subject is ${commit.subject.length} chars, over the ${MAX_COMMIT_SUBJECT_LENGTH}-char concise-commit limit.`,
      );
    }
    const markers = findAttributionMarkers(`${commit.subject}\n${commit.body}`);
    if (markers.length > 0) {
      reasons.push(
        `commit ${index + 1} carries development-engine attribution: ${markers.join(", ")}.`,
      );
    }
  });

  if (record.evidenceBundle.length === 0) {
    reasons.push("no evidence bundle was produced — the handoff is not evidence-backed.");
  } else {
    const missing = record.evidenceBundle.filter((path) => !input.pathExists(path));
    if (missing.length > 0) {
      reasons.push(`evidence bundle artifact(s) do not resolve: ${missing.join(", ")}.`);
    }
    details.push(
      `${record.evidenceBundle.length} bundle artifact(s), ${record.commits.length} commit(s).`,
    );
  }

  return buildCheckResult(reasons, details);
}

/**
 * Reads a previously-archived demo-run record, if one exists.
 *
 * Retained only as a fallback for a release cut that archives its demo run
 * rather than performing one inline. The primary path is
 * `runDemoBranchEvidenceHandoff` below, which PERFORMS the run — a
 * hand-written record describing a demo is not a demo.
 */
export function readDemoRunRecord(repoRoot: string): DemoRunRecord | undefined {
  const path = join(repoRoot, DEMO_RUN_RECORD_PATH);
  if (!existsSync(path)) return undefined;
  return DemoRunRecordSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
}

export function readDemoBranchEvidenceHandoffInput(
  repoRoot: string,
  releaseCandidateObjectId: string,
): CheckDemoBranchEvidenceHandoffInput {
  return {
    releaseCandidateObjectId,
    record: readDemoRunRecord(repoRoot),
    pathExists: (repoRelativePath) => existsSync(join(repoRoot, repoRelativePath)),
  };
}

/**
 * Performs a REAL demo run and returns the check input describing it.
 *
 * `pathExists` resolves absolute bundle paths directly, because the bundle
 * this run produces lives in a throwaway directory rather than in the
 * repository — the artifacts are outputs of the run, not committed files.
 *
 * Imported lazily so that merely importing this module (as the pure-check
 * unit tests do) never drags in `@eo/git-engine`/`@eo/renderer`.
 */
export async function runDemoBranchEvidenceHandoff(
  releaseCandidateObjectId: string,
): Promise<CheckDemoBranchEvidenceHandoffInput & { readonly lintFindings: readonly string[] }> {
  const { runDemoPublication } = await import("./demoRun.js");
  const result = await runDemoPublication({ releaseCandidateObjectId });
  return {
    releaseCandidateObjectId,
    record: result.record,
    lintFindings: result.lintFindings,
    pathExists: (candidate) => existsSync(candidate),
  };
}
