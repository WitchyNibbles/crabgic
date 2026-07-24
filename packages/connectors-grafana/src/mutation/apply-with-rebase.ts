import { randomUUID } from "node:crypto";
import { executeMutationPlan } from "@eo/gateway";
import type {
  MutationPipelineDeps,
  MutationPipelineHandlers,
  MutationPipelineOutcome,
} from "@eo/gateway";
import type { RemoteMutationPlan } from "@eo/contracts";
import {
  hashCanonicalFields,
  type GrafanaResourceDefinition,
} from "../resources/resource-definitions.js";
import { resolveOptimisticConcurrencyConflict } from "./precondition.js";
import type { GrafanaPlanPayloadStore } from "./plan-payload-store.js";
import type { GrafanaRawHttpResponse } from "./mutation-apply-client.js";

export interface ApplyWithRebaseDeps {
  readonly definition: GrafanaResourceDefinition;
  readonly basePath: string;
  readonly externalId: string;
  /** The content hash of the remote resource AS IT STOOD when THIS plan's own `expectedRemoteRevision` was captured (i.e. at `planUpdate` time) — the baseline `./precondition.js` compares a post-conflict re-fetch against. */
  readonly baselineContentHash: string;
  readonly get: (path: string) => Promise<GrafanaRawHttpResponse>;
  readonly payloadStore: GrafanaPlanPayloadStore;
}

/**
 * Executes `plan` through `@eo/gateway`'s `executeMutationPlan`, then — ONLY
 * when the result is a 409/412-mapped `failed`/`conflict` outcome — performs
 * this phase's own fetch-compare-rebase-or-block resolution (roadmap/20 §In
 * scope: "optimistic-concurrency writes (409/412 → fetch-compare-rebase or
 * an explicit block, never a blind overwrite)"). `@eo/gateway`'s own
 * pipeline treats a conflict as terminal and never retries the SAME
 * idempotency key (a "failed" journal record is authoritative and is
 * never silently re-attempted — see that package's own mutation-pipeline
 * doc comment) — a safe rebase is therefore always a NEW, distinctly
 * idempotency-keyed attempt, never a mutation of the original plan/record.
 */
export async function applyGrafanaMutationWithRebase(
  plan: RemoteMutationPlan,
  handlers: MutationPipelineHandlers,
  pipelineDeps: MutationPipelineDeps,
  rebaseDeps: ApplyWithRebaseDeps,
): Promise<MutationPipelineOutcome> {
  const outcome = await executeMutationPlan(plan, handlers, pipelineDeps);
  if (outcome.status !== "failed" || outcome.errorKind !== "conflict") {
    return outcome;
  }

  const getSpec = rebaseDeps.definition.buildGetRequest(rebaseDeps.basePath, rebaseDeps.externalId);
  const response = await rebaseDeps.get(getSpec.path);
  if (response.status >= 400) {
    return {
      status: "blocked",
      errorKind: "conflict",
      detail: `fetch-compare-rebase: could not read current remote state (HTTP ${response.status})`,
    };
  }
  const canonical = rebaseDeps.definition.parseCanonical(
    rebaseDeps.externalId,
    response.bodyText,
    response.headers,
  );
  const resolution = resolveOptimisticConcurrencyConflict({
    baselineContentHash: rebaseDeps.baselineContentHash,
    currentRemote: {
      revision: canonical.revision,
      contentHash: hashCanonicalFields(canonical.fields),
    },
  });

  if (resolution.kind === "block") {
    return { status: "blocked", errorKind: "conflict", detail: resolution.reason };
  }

  // Safe rebase: the remote's CONTENT is unchanged since our baseline —
  // only the revision token went stale. Retry as a brand-new, distinctly
  // idempotency-keyed attempt against the fresh revision.
  const originalPayload = rebaseDeps.payloadStore.get(plan.id);
  const rebasedPlan: RemoteMutationPlan = {
    ...plan,
    id: randomUUID(),
    idempotencyKey: `${plan.idempotencyKey}:rebase:${resolution.freshRevision}`,
    expectedRemoteRevision: resolution.freshRevision,
  };
  if (originalPayload !== undefined) {
    rebaseDeps.payloadStore.set(rebasedPlan.id, originalPayload);
  }

  return executeMutationPlan(rebasedPlan, handlers, pipelineDeps);
}
