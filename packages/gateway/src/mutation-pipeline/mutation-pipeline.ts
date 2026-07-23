/**
 * Mutation pipeline — roadmap/16-gateway-core.md §In scope, "Mutation
 * pipeline": "`RemoteMutationPlan` (...) → persist `RemoteOperationRecord`
 * before network I/O → apply → read-back compare → verify → record.
 * Same-ID+same-content replays the recorded result byte-identical;
 * different content is a typed conflict, never a silent overwrite." Work
 * item 4.
 *
 * ADVERSARIAL-REVIEW FIXES (this file's second revision):
 *
 *  - **HIGH #2** ("mutating tools bypass this pipeline entirely, with no
 *    SSRF guard or write-serializer on the mutate path"): this module now
 *    OWNS the network I/O itself — `handlers.buildRequest`/`parseResponse`
 *    describe the provider-specific request/response shape only;
 *    `executeMutationPlan` is the sole caller of `deps.httpClient.request`,
 *    so every mutation ALWAYS goes through `../transport/http-client.js`'s
 *    full stack (SSRF guard, redirect revalidation, retry ladder, budgets,
 *    per-tenant+resource write serialization). No caller can construct a
 *    mutating MCP tool that skips this.
 *
 *  - **HIGH/MEDIUM #3** ("pending and committed records used DIFFERENT
 *    operationIds, so `checkOrRecord` never saw the pending record, and a
 *    kill-after-commit-before-record crash re-entered `compute()` and
 *    re-applied — duplicate avoided only by the test fixture's own
 *    idempotence, not by this pipeline"): this module no longer delegates
 *    to `@eo/journal`'s generic `IdempotencyRegistry.checkOrRecord` at
 *    all. It manages the full `pending → recorded/conflict/failed` state
 *    machine itself, directly over `deps.journal.appendEntry`/
 *    `queryEntries`, using the SAME `operationId` (`plan.idempotencyKey`)
 *    for both the pre-I/O pending write and the eventual terminal write —
 *    the "latest entry for this operationId" IS the authoritative current
 *    state, so a restart that finds a `pending` (non-terminal) record for
 *    this operationId is DETECTABLE and is never silently reinterpreted
 *    as "brand new." A found-pending record on restart is NEVER blindly
 *    retried: `handlers.reconcileAmbiguous`, if supplied, is the only path
 *    to a `recorded` outcome from that state (see below); without it, the
 *    outcome is `blocked`/`ambiguous_write` — fails closed, never guesses.
 *
 *  - **MEDIUM #5** ("checkOrRecord is documented as unsafe for concurrent
 *    first-writers of the same operationId — two concurrent calls could
 *    both observe 'no prior record' and both apply"): the entire
 *    query-then-decide-then-write critical section is now wrapped in a
 *    per-idempotencyKey exclusive lock (`IdempotencyKeyLock`, a thin,
 *    semantically-named wrapper over `../transport/write-serializer.js`'s
 *    `WriteSerializer` — the identical keyed-mutex primitive already
 *    proven correct for per-tenant+resource write ordering, reused here
 *    for a different key space).
 *
 * Network-level ambiguity (a mid-request fault, e.g. a mid-POST timeout,
 * OR a crash-recovery restart finding a `pending`-but-not-terminal prior
 * attempt) is never silently retried: `handlers.reconcileAmbiguous`, when
 * supplied, is given the chance to determine via provider-specific
 * marker-reconciliation (`./reconciliation.js`) whether the mutation
 * already landed; absent that hook, or when it cannot determine an
 * answer, the outcome is `blocked`/`ambiguous_write` — canonical fail-
 * closed, per roadmap/16 §In scope, "Ambiguity."
 */

import { randomUUID } from "node:crypto";
import {
  CURRENT_SCHEMA_VERSION,
  ConnectorError,
  type RemoteMutationPlan,
  type RemoteOperationRecord,
} from "@eo/contracts";
import type { JournalStore } from "@eo/journal";
import type { GatewayHttpClient } from "../transport/http-client.js";
import type { HttpTransportResponse } from "../transport/http-transport.js";
import type { HttpVerb } from "../transport/retry-ladder.js";
import { mapHttpStatusToConnectorError } from "./error-mapping.js";
import { AmbiguousWriteBlockedError } from "./reconciliation.js";
import { WriteSerializer } from "../transport/write-serializer.js";

export class MutationVerificationFailedError extends Error {
  readonly planId: string;

  constructor(planId: string, detail: string) {
    super(`mutation verification failed for plan ${planId}: ${detail}`);
    this.name = "MutationVerificationFailedError";
    this.planId = planId;
    Object.freeze(this);
  }
}

export interface MutationApplyResult {
  /** The confirmed remote revision this record's read-back step observed (roadmap/16: "the confirmed remote revision its own read-back step yields"). */
  readonly appliedRevision: string;
}

/** The outbound HTTP request a provider's mutation needs — `executeMutationPlan` is the sole issuer of this request, via `deps.httpClient` (HIGH #2). */
export interface MutationHttpRequestSpec {
  readonly url: URL;
  readonly method: HttpVerb;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly hasPrecondition?: boolean;
}

export interface MutationPipelineHandlers {
  /** The provider name — used only for canonical-error attribution (`../mutation-pipeline/error-mapping.js`), never logged/leaked beyond that. */
  readonly provider: string;
  /** Builds the outbound HTTP request for this plan's mutation. Pure — no I/O of its own. */
  buildRequest(plan: RemoteMutationPlan): MutationHttpRequestSpec;
  /** Parses a successful (status < 400) HTTP response into the applied result. */
  parseResponse(plan: RemoteMutationPlan, response: HttpTransportResponse): MutationApplyResult;
  /** Read-back compare + verify: confirms the applied change is actually reflected remotely. Returning `false` (rather than throwing) signals a verification mismatch, mapped to a `failed` outcome. */
  verify(plan: RemoteMutationPlan, applied: MutationApplyResult): Promise<boolean>;
  /**
   * Optional marker-reconciliation hook (`./reconciliation.js`), consulted
   * whenever this mutation's outcome is ambiguous: either the network
   * call itself failed ambiguously (`cause` is that error), or a restart
   * found a `pending`-but-not-terminal prior attempt for this operationId
   * (`cause` is a synthetic marker error in that case). Returning a
   * `MutationApplyResult` means "already applied — use this, no new
   * network call"; returning `undefined` means "genuinely unknown," which
   * maps to a `blocked`/`ambiguous_write` outcome. Absent entirely, EVERY
   * ambiguous outcome fails closed (never guesses, never blindly retries).
   */
  reconcileAmbiguous?(
    plan: RemoteMutationPlan,
    cause: unknown,
  ): Promise<MutationApplyResult | undefined>;
}

export type MutationOutcomeStatus = "recorded" | "replayed" | "conflict" | "blocked" | "failed";

export interface MutationPipelineOutcome {
  readonly status: MutationOutcomeStatus;
  readonly appliedRevision?: string;
  readonly errorKind?: ConnectorError["kind"];
  readonly detail?: string;
}

export interface MutationPipelineDeps {
  readonly journal: JournalStore;
  readonly httpClient: GatewayHttpClient;
  /** The per-idempotencyKey exclusive lock (MEDIUM #5) — share ONE instance across every `executeMutationPlan` call for a given gateway/connection so concurrent same-key calls are actually serialized against each other, not just within a single call. */
  readonly lock: IdempotencyKeyLock;
}

/**
 * Per-idempotencyKey exclusive execution (MEDIUM #5, adversarial-review
 * fix) — a thin, semantically-named wrapper over `WriteSerializer` (the
 * identical keyed-mutex primitive already used for per-tenant+resource
 * write ordering), reused here for a different key space (idempotency
 * keys, not tenant+resource pairs) so two concurrent `executeMutationPlan`
 * calls for the SAME `idempotencyKey` never race on the
 * query-existing-then-decide-then-write critical section.
 */
export class IdempotencyKeyLock {
  readonly #serializer = new WriteSerializer();

  async runExclusive<T>(idempotencyKey: string, task: () => Promise<T>): Promise<T> {
    return this.#serializer.runExclusive(
      { tenant: "idempotency-key", resource: idempotencyKey },
      task,
    );
  }
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { rawTextLength: text.length };
  }
}

async function findLatestRecordForOperation(
  journal: JournalStore,
  operationId: string,
): Promise<RemoteOperationRecord | undefined> {
  let latest: RemoteOperationRecord | undefined;
  for await (const entry of journal.queryEntries({ type: "remote_operation_record" })) {
    if (entry.type === "remote_operation_record" && entry.payload.operationId === operationId) {
      latest = entry.payload; // queryEntries yields in append order — the last match is authoritative.
    }
  }
  return latest;
}

async function persistRecord(
  journal: JournalStore,
  plan: RemoteMutationPlan,
  status: RemoteOperationRecord["status"],
  extra: Partial<Pick<RemoteOperationRecord, "appliedRevision" | "errorKind">>,
): Promise<void> {
  await journal.appendEntry({
    type: "remote_operation_record",
    payload: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: randomUUID(),
      remoteMutationPlanId: plan.id,
      operationId: plan.idempotencyKey,
      contentHash: plan.desiredStateHash,
      status,
      recordedAt: journal.config.clock(),
      ...extra,
    },
  });
}

/** Performs the actual network I/O (via `deps.httpClient` — HIGH #2) plus read-back/verify. Throws `AmbiguousWriteBlockedError`, `MutationVerificationFailedError`, or `ConnectorError` on failure; never returns a partial/unverified result. */
async function performApplyOnce(
  plan: RemoteMutationPlan,
  handlers: MutationPipelineHandlers,
  deps: Pick<MutationPipelineDeps, "httpClient">,
): Promise<MutationApplyResult> {
  const spec = handlers.buildRequest(plan);

  let response: HttpTransportResponse;
  try {
    response = await deps.httpClient.request({
      connectionId: plan.externalConnectionId,
      tenant: plan.tenant,
      resource: plan.canonicalTarget,
      isWrite: true,
      url: spec.url,
      method: spec.method,
      ...(spec.headers !== undefined ? { headers: spec.headers } : {}),
      ...(spec.body !== undefined ? { body: spec.body } : {}),
      ...(spec.hasPrecondition !== undefined ? { hasPrecondition: spec.hasPrecondition } : {}),
    });
  } catch (networkErr) {
    if (networkErr instanceof AmbiguousWriteBlockedError) throw networkErr;
    if (handlers.reconcileAmbiguous !== undefined) {
      const reconciled = await handlers.reconcileAmbiguous(plan, networkErr);
      if (reconciled !== undefined) return reconciled;
    }
    const detail = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new AmbiguousWriteBlockedError(`network call failed ambiguously: ${detail}`);
  }

  if (response.status >= 400) {
    throw mapHttpStatusToConnectorError({
      status: response.status,
      provider: handlers.provider,
      rawProviderResponse: safeParseJson(response.bodyText),
    });
  }

  const applied = handlers.parseResponse(plan, response);
  const verified = await handlers.verify(plan, applied);
  if (!verified) {
    throw new MutationVerificationFailedError(
      plan.id,
      "read-back did not confirm the desired state",
    );
  }
  return applied;
}

function mapCaughtErrorToOutcome(err: unknown): MutationPipelineOutcome | undefined {
  if (err instanceof AmbiguousWriteBlockedError) {
    return { status: "blocked", errorKind: "ambiguous_write", detail: err.message };
  }
  if (err instanceof MutationVerificationFailedError) {
    return { status: "failed", errorKind: "conflict", detail: err.message };
  }
  if (err instanceof ConnectorError) {
    return { status: "failed", errorKind: err.kind, detail: err.redactedDetail };
  }
  return undefined; // an unexpected programming error — propagate, never swallow.
}

async function applyVerifyRecord(
  plan: RemoteMutationPlan,
  handlers: MutationPipelineHandlers,
  deps: MutationPipelineDeps,
): Promise<MutationPipelineOutcome> {
  try {
    const applied = await performApplyOnce(plan, handlers, deps);
    await persistRecord(deps.journal, plan, "recorded", {
      appliedRevision: applied.appliedRevision,
    });
    return { status: "recorded", appliedRevision: applied.appliedRevision };
  } catch (err) {
    const outcome = mapCaughtErrorToOutcome(err);
    if (outcome === undefined) throw err;
    await persistRecord(
      deps.journal,
      plan,
      "failed",
      outcome.errorKind !== undefined ? { errorKind: outcome.errorKind } : {},
    );
    return outcome;
  }
}

/**
 * HIGH/MEDIUM #3: a restart found a `pending`-but-not-terminal record for
 * this operationId — a prior attempt's network-call outcome is unknown.
 * NEVER blindly retried: only `handlers.reconcileAmbiguous` can turn this
 * into a `recorded` outcome; absent it (or if it can't determine an
 * answer), this fails closed as `blocked`/`ambiguous_write`.
 */
async function reconcilePendingOperation(
  plan: RemoteMutationPlan,
  handlers: MutationPipelineHandlers,
  deps: MutationPipelineDeps,
): Promise<MutationPipelineOutcome> {
  if (handlers.reconcileAmbiguous === undefined) {
    await persistRecord(deps.journal, plan, "failed", { errorKind: "ambiguous_write" });
    return {
      status: "blocked",
      errorKind: "ambiguous_write",
      detail:
        "a prior attempt for this operation crashed before reaching a terminal state, and no reconciliation hook was supplied — never blindly re-applied",
    };
  }

  try {
    const cause = new Error(
      "crash-recovery: a prior attempt's network-call outcome for this operationId is unknown",
    );
    const reconciled = await handlers.reconcileAmbiguous(plan, cause);
    if (reconciled === undefined) {
      await persistRecord(deps.journal, plan, "failed", { errorKind: "ambiguous_write" });
      return {
        status: "blocked",
        errorKind: "ambiguous_write",
        detail: "reconciliation could not determine the prior attempt's outcome",
      };
    }
    await persistRecord(deps.journal, plan, "recorded", {
      appliedRevision: reconciled.appliedRevision,
    });
    return { status: "recorded", appliedRevision: reconciled.appliedRevision };
  } catch (err) {
    const outcome = mapCaughtErrorToOutcome(err);
    if (outcome === undefined) throw err;
    await persistRecord(
      deps.journal,
      plan,
      "failed",
      outcome.errorKind !== undefined ? { errorKind: outcome.errorKind } : {},
    );
    return outcome;
  }
}

async function executeMutationPlanLocked(
  plan: RemoteMutationPlan,
  handlers: MutationPipelineHandlers,
  deps: MutationPipelineDeps,
): Promise<MutationPipelineOutcome> {
  const existing = await findLatestRecordForOperation(deps.journal, plan.idempotencyKey);

  if (existing !== undefined && existing.contentHash !== plan.desiredStateHash) {
    return {
      status: "conflict",
      errorKind: "conflict",
      detail: `operationId "${plan.idempotencyKey}" already recorded with a different contentHash`,
    };
  }

  if (existing?.status === "recorded") {
    return existing.appliedRevision !== undefined
      ? { status: "replayed", appliedRevision: existing.appliedRevision }
      : { status: "replayed" };
  }

  if (existing?.status === "failed" || existing?.status === "conflict") {
    return {
      status: existing.status,
      ...(existing.errorKind !== undefined ? { errorKind: existing.errorKind } : {}),
      detail: `previously recorded as ${existing.status}, never re-run`,
    };
  }

  if (existing?.status === "pending") {
    return reconcilePendingOperation(plan, handlers, deps);
  }

  // Brand-new operation: persist RemoteOperationRecord BEFORE any network I/O.
  await persistRecord(deps.journal, plan, "pending", {});
  return applyVerifyRecord(plan, handlers, deps);
}

/**
 * Executes one `RemoteMutationPlan` through the full pipeline. Never
 * throws for an expected outcome (conflict/blocked/failed are all
 * returned, not thrown) — only an unexpected programming error propagates.
 * Serialized per `plan.idempotencyKey` (MEDIUM #5) — concurrent calls for
 * the SAME key never race on the query-then-decide-then-write section.
 */
export async function executeMutationPlan(
  plan: RemoteMutationPlan,
  handlers: MutationPipelineHandlers,
  deps: MutationPipelineDeps,
): Promise<MutationPipelineOutcome> {
  return deps.lock.runExclusive(plan.idempotencyKey, () =>
    executeMutationPlanLocked(plan, handlers, deps),
  );
}
