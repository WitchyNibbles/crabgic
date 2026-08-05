/**
 * A no-repository stand-in for the post-completion pipeline's GIT effects, for
 * the dispatcher suites that script a succeeding worker over fake git seams and
 * have no real repository to collect, integrate or publish into.
 *
 * WHAT IT DOES NOT FAKE, and this is the whole point of where the seam sits:
 * the gate registry is still composed by production code, the
 * `final_verifying` firing is still real, and the verdict → run-lifecycle
 * mapping is still the pipeline's. A suite using this fake therefore still
 * reddens if `composeGateRegistry` stops registering the seal gate
 * (`fireFinalCandidateVerification`'s `requireAtLeastOne` throws and the run
 * settles `failed`). The object ids below are deterministic SHA-1-shaped
 * digests so `EvidenceRecordSchema` accepts them and so a test can assert the
 * SAME id twice without either side reading it back from the other.
 *
 * Real git — control clone, `git worktree add`, `merge-tree`, CAS `update-ref`,
 * `publishLocal` into a real user repo — is covered by
 * `../composed-post-completion.e2e.test.ts`, which uses the production default.
 *
 * Not part of the published package (`packages/cli`'s `files` excludes
 * `dist/**\/test-support/**`).
 */
import { createHash } from "node:crypto";
import { buildIntegrationRef } from "@crabgic/git-engine";
import type { PostCompletionGitEffects } from "../post-completion-git-effects.js";

/** A deterministic, SHA-1-shaped object id for `label` — schema-valid and stable across runs. */
export function fakeObjectId(label: string): string {
  return createHash("sha1").update(label).digest("hex");
}

export interface FakePostCompletionGitEffectsOptions {
  /** Records every method the pipeline called, in order — so a test can assert the walk actually reached publication. */
  readonly calls?: string[];
}

export function createFakePostCompletionGitEffects(
  options: FakePostCompletionGitEffectsOptions = {},
): PostCompletionGitEffects {
  const calls = options.calls;
  let tip = "";
  return {
    collectCandidate(input) {
      calls?.push(`collect:${input.workUnit.id}`);
      return Promise.resolve({
        status: "collected",
        objectId: fakeObjectId(`candidate:${input.workUnit.id}`),
      });
    },
    beginIntegration(input) {
      calls?.push(`begin:${input.runId}`);
      tip = input.baseObjectId;
      return Promise.resolve({
        status: "begun",
        ref: buildIntegrationRef(input.runId),
        tipObjectId: tip,
      });
    },
    integrateCandidate(input) {
      calls?.push(`integrate:${input.workUnit.id}`);
      // Folds the candidate INTO the tip, so the resulting id depends on every
      // unit integrated so far — a test asserting the final id cannot be
      // satisfied by any single unit's candidate.
      tip = fakeObjectId(`${tip}+${input.candidateObjectId}`);
      return Promise.resolve({ status: "integrated", tipObjectId: tip });
    },
    resolveIntegratedObjectId(input) {
      calls?.push(`resolve:${input.ref}`);
      return Promise.resolve(tip);
    },
    publishCandidate(input) {
      calls?.push(`publish:${input.ref}`);
      return Promise.resolve({
        status: "published",
        branchName: `${input.branchType}/fake-published`,
        objectId: tip,
      });
    },
  };
}
