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
 *    to `@crabgic/journal`'s generic `IdempotencyRegistry.checkOrRecord` at
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
} from "@crabgic/contracts";
import type { JournalStore } from "@crabgic/journal";
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

/**
 * Where a mutation lands, in folder terms — the answer
 * `MutationPipelineHandlers.folderAttribution` gives so
 * `ExternalConnection.folderAllowlist` can be checked (DEFECT 16).
 *
 * THREE answers, not two, and the third is the point. Tenancy has two
 * because `plan.tenant` is a required field on every plan. A folder is
 * not on the plan at all, so a provider can be in one of three genuinely
 * different states, and collapsing them loses the distinction between
 * "this resource legitimately lives outside every folder" and "I do not
 * know where this lives" — which are the same refusal but very different
 * operator advice.
 *
 * Only `"folders"` can ever be ADMITTED against an allowlist. The other
 * two are refused whenever a `folderAllowlist` is declared, because an
 * allowlist of folders says "writes on this connection happen inside
 * these folders" and neither of them does.
 */
export type MutationFolderAttribution =
  /** The mutation lands inside these folders (provider-native folder ids). Every one of them must be an allowlist member. An EMPTY list is treated as `"unknown"`, never as vacuously admissible. */
  | { readonly scope: "folders"; readonly folders: readonly string[] }
  /** The mutation legitimately targets no folder — an org-level resource (20's contact points, mute timings, notification templates) or a root-level one. */
  | { readonly scope: "outside-folders" }
  /** The provider cannot place this mutation from the plan alone (e.g. 20's `annotation`, whose folder is transitive through its dashboard and needs a remote read). */
  | { readonly scope: "unknown" };

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
   * Optional SERIALIZATION-ONLY key for the write mutex this pipeline
   * hands `../transport/http-client.js` (`WriteSerializer`, keyed on
   * `tenant` + `resource`). Absent, `resource` is `plan.canonicalTarget`
   * exactly — the default every provider had before this hook existed,
   * and still the behavior for any provider (e.g. 20's Grafana, whose
   * targets are flat `<kind>:<id>`) that omits it.
   *
   * It exists because identity and mutex-granularity are NOT the same
   * question. `canonicalTarget` is a plan's identity: it is the marker-
   * reconciliation and audit identifier, and 18/19's Jira apply clients
   * parse a `commentId` back out of it, so it cannot be coarsened. But
   * 18's four issue-scoped shapes on ONE issue (`issue:K`,
   * `issue:K:comment`, `issue:K:worklog`, `issue:K:attachment`) must
   * take one mutex for roadmap/18 exit criterion 10's "per-issue write
   * order preserved" to hold. This hook is the seam between the two.
   *
   * PLURAL FORM. Returning an ARRAY means "this write must serialize
   * against every one of these keys at once" — the shape 18/19's
   * `bulk:<keys>` targets need, where one plan acts on several named
   * issues and must take each member issue's mutex (roadmap/18 §Exit
   * criteria 10). A single string, or a one-element array, is the
   * original behavior byte-for-byte: `resource` carries the key and no
   * `serializationResources` is sent. An empty array falls back to
   * `plan.canonicalTarget` — a write is never left unkeyed.
   *
   * Must be a pure function of the plan — it is consulted once per
   * network attempt and must return the same key set every time, or
   * writes that should serialize will not.
   */
  serializationTarget?(plan: RemoteMutationPlan): string | readonly string[];
  /**
   * DEFECT 16 — where this mutation LANDS, in folder terms, for
   * `ExternalConnection.folderAllowlist` to be checked against. See
   * `refuseOutOfAllowlistFolder` below for the admission semantics and
   * `MutationFolderAttribution` for why there are three answers rather
   * than two.
   *
   * WHY A PROVIDER HOOK AND NOT A PLAN FIELD: `RemoteMutationPlanSchema`
   * is `.strict()` and names no folder (`@crabgic/contracts`'
   * `remote-mutation-plan.ts`) — a folder is a provider-shaped concept
   * that only 20's Grafana has at all, so the pipeline has to ask. The
   * seam mirrors `serializationTarget` above deliberately: same optional
   * shape, same purity requirement, same forwarding path through
   * `../mcp/native-tools/mutation-apply-tool.js`.
   *
   * ABSENT means "this provider has no folder concept" (18/19's Jira
   * clients), which is NOT the same as "admit everything": on a
   * connection that declares a `folderAllowlist`, an unattributable
   * mutation is refused. Must be a pure function of the plan — it is
   * consulted before any I/O and must not itself perform any.
   */
  folderAttribution?(plan: RemoteMutationPlan): MutationFolderAttribution;
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
  /**
   * DEFECT 21 — `ExternalConnection.tenantAllowlist` for the connection this
   * plan targets. See `refuseOutOfAllowlistTenant` below for the semantics
   * and the scope of what this does and does not bind.
   *
   * REQUIRED-BUT-`| undefined`, not `?:`, and that is the point. This repo
   * sets `exactOptionalPropertyTypes: true` (`tsconfig.base.json`), so a
   * required `| undefined` member forces EVERY construction site to write
   * its answer out. An optional member would let a new call site omit the
   * allowlist silently and re-open exactly the hole this field was added to
   * close. Types-only break for external `@crabgic/gateway` consumers; JS
   * callers are runtime-compatible (an omitted key reads as `undefined`,
   * i.e. unscoped, which is the pre-fix behaviour).
   */
  readonly tenantAllowlist: readonly string[] | undefined;
  /**
   * DEFECT 16 — `ExternalConnection.folderAllowlist` for the connection this
   * plan targets, the third declared-and-inert sibling of `tenantAllowlist`.
   * See `refuseOutOfAllowlistFolder` below for the semantics and scope.
   *
   * REQUIRED-BUT-`| undefined` for exactly the reason the field above is
   * (`exactOptionalPropertyTypes: true` forces every construction site to
   * write its answer out); an optional member would let a new call site omit
   * the allowlist silently and re-open the hole. Types-only break for
   * external `@crabgic/gateway` consumers; JS callers are runtime-compatible
   * (an omitted key reads as `undefined`, i.e. unscoped — the pre-fix
   * behaviour).
   */
  readonly folderAllowlist: readonly string[] | undefined;
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

  // `serializationTarget` may answer with one key or a SET of keys (see
  // its doc comment). The single-key path below is byte-for-byte the
  // behavior every provider had before the plural form existed; the
  // multi-key path additionally sends `serializationResources` and keeps
  // `canonicalTarget` in `resource` as the audit/attribution value.
  const rawTargets = handlers.serializationTarget?.(plan) ?? plan.canonicalTarget;
  const targets = typeof rawTargets === "string" ? [rawTargets] : [...rawTargets];
  // An empty array would leave the write unkeyed — fall back to identity.
  const primaryTarget = targets[0] ?? plan.canonicalTarget;

  let response: HttpTransportResponse;
  try {
    response = await deps.httpClient.request({
      connectionId: plan.externalConnectionId,
      tenant: plan.tenant,
      resource: targets.length > 1 ? plan.canonicalTarget : primaryTarget,
      isWrite: true,
      ...(targets.length > 1 ? { serializationResources: targets } : {}),
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
 * TENANT-ALLOWLIST ADMISSION CHECK — defect 21.
 *
 * `ExternalConnection.tenantAllowlist` was declared in the published
 * contract, emitted into the published JSON Schema, and read by no code
 * anywhere. An operator who set it would reasonably believe cross-tenant
 * writes were refused; nothing refused them. This function is the
 * enforcement.
 *
 * WHY IT LIVES IN THIS MODULE and not in the MCP tool layer: HIGH #2 (see
 * this file's header) makes `executeMutationPlan` the sole issuer of
 * mutation network I/O — "No caller can construct a mutating MCP tool that
 * skips this." A check at the tool layer would also miss the second
 * production caller, `@crabgic/connectors-grafana`'s
 * `applyGrafanaMutationWithRebase`, which re-enters this pipeline with a
 * rebased plan. One check here covers both, and there is deliberately no
 * second overlapping check elsewhere — overlapping checks silently absorb
 * each other's test coverage, so the older one stops being pinned.
 *
 * WHY IT IS NOT IN `GatewayHttpClient.request()`, the seam that would cover
 * reads too: read requests carry PSEUDO-tenants, not tenant identities —
 * `"oauth"`, `"doctor-probe"`, or the connection id — used purely as
 * `WriteSerializer` concurrency keys. A request-level check would refuse
 * every read on a tenant-scoped connection unless operators listed those
 * magic strings. Reads are a named residual, not an oversight.
 *
 * SEMANTICS. `undefined` (field absent) = tenant-unscoped, no check. `[]` =
 * refuse EVERY mutation: an empty allowlist is a deliberate "nothing is
 * permitted", the same reading `checkGrafanaConnectionDoctor` already gives
 * an empty `orgAllowlist`. The opposite case, named so the distinction is
 * legible: "no opinion" is expressed by OMITTING the field, never by an
 * empty array.
 *
 * SCOPE — do not over-trust this. It binds the tenant a plan DECLARES. It
 * does not verify the remote's actual tenant identity (provider-specific
 * doctor work) and does not cover reads. What it adds beyond making the
 * contract honest is real but narrow: `plan.tenant` arrives from the
 * semi-trusted worker side and keys both the per-tenant+resource write
 * serializer and journal attribution, so before this check a forged tenant
 * string passed entirely unexamined.
 */
function refuseOutOfAllowlistTenant(
  plan: RemoteMutationPlan,
  tenantAllowlist: readonly string[] | undefined,
): MutationPipelineOutcome | undefined {
  if (tenantAllowlist === undefined) return undefined;
  if (tenantAllowlist.includes(plan.tenant)) return undefined;
  return {
    status: "failed",
    errorKind: "policy_blocked",
    // The refused tenant value is deliberately NOT echoed back: it is a
    // worker-declared, unvalidated string, and the caller already knows what
    // it sent. Nothing is lost, and no untrusted text enters an outcome that
    // crosses a process boundary as an MCP tool result.
    detail:
      tenantAllowlist.length === 0
        ? "this connection's tenantAllowlist is empty, so every mutation is refused (fail-closed); refused before any network I/O and without journalling a RemoteOperationRecord"
        : "the plan's declared tenant is outside this connection's tenantAllowlist; refused before any network I/O and without journalling a RemoteOperationRecord",
  };
}

/**
 * FOLDER-ALLOWLIST ADMISSION CHECK — defect 16.
 *
 * `ExternalConnection.folderAllowlist` was the third declared-and-inert
 * sibling of `tenantAllowlist`: emitted into the published JSON Schema,
 * settable by an operator, read by no code anywhere. This function is the
 * enforcement, and it lives beside `refuseOutOfAllowlistTenant` for the same
 * reason that one does — `executeMutationPlan` is the sole issuer of
 * mutation network I/O (HIGH #2), so one check here covers the MCP apply
 * tool AND `@crabgic/connectors-grafana`'s re-entrant
 * `applyGrafanaMutationWithRebase`, and there is deliberately no second
 * overlapping check elsewhere.
 *
 * WHAT IT DOES *NOT* SHARE with the tenant check, stated because the two
 * look like siblings and are not: a plan's tenant is a required plan field,
 * so tenancy is decidable here. A folder is NOT on the plan
 * (`RemoteMutationPlanSchema` is `.strict()` and names none), so this check
 * asks the provider via `MutationPipelineHandlers.folderAttribution` and its
 * strength is bounded by that answer's honesty.
 *
 * SEMANTICS — the first two mirror the tenant check exactly:
 *  - `undefined` (field absent) = folder-unscoped, no check runs at all.
 *    Nothing about a connection that sets no `folderAllowlist` changes.
 *  - `[]` = refuse EVERY mutation (fail-closed). An empty allowlist is a
 *    deliberate "nothing is permitted", never "no opinion" — which is
 *    expressed by omitting the field.
 *  - non-empty = admit ONLY a mutation the provider places inside a listed
 *    folder. `"outside-folders"` and `"unknown"` are both refused, with
 *    distinct details.
 *
 * THE UNATTRIBUTABLE RULING, filling a silence rather than papering one
 * over. The spec says nothing about a provider with no folder concept. Two
 * readings were available: admit (the field then binds only providers that
 * opted in, with nothing telling an operator which — a control that is
 * trusted and inert for everyone else, i.e. the exact defect shape this
 * closes), or refuse. It refuses. The visible consequence, so nobody
 * rediscovers it as a bug: setting `folderAllowlist` on a Jira connection
 * refuses every Jira mutation on it, loudly and with a typed reason,
 * because 18/19 register no `folderAttribution` — Jira has no folder in its
 * model.
 *
 * SCOPE — do not over-trust this. It binds the folder a provider derives
 * FROM THE PLAN, on the mutation path. It does not verify where the
 * resource actually lives on the remote (a dashboard moved server-side
 * still reports its plan's folder), and it does not cover reads — for the
 * same reason the tenant check does not: read requests carry pseudo-tenants
 * used purely as concurrency keys.
 */
function refuseOutOfAllowlistFolder(
  plan: RemoteMutationPlan,
  folderAllowlist: readonly string[] | undefined,
  handlers: MutationPipelineHandlers,
): MutationPipelineOutcome | undefined {
  if (folderAllowlist === undefined) return undefined;
  const refused = (detail: string): MutationPipelineOutcome => ({
    status: "failed",
    errorKind: "policy_blocked",
    // No provider-supplied folder id is echoed back, matching the tenant
    // check: the value is worker-reachable, unvalidated text and the caller
    // already knows what it sent.
    detail: `${detail}; refused before any network I/O and without journalling a RemoteOperationRecord`,
  });
  if (folderAllowlist.length === 0) {
    return refused(
      "this connection's folderAllowlist is empty, so every mutation is refused (fail-closed)",
    );
  }

  const attribution: MutationFolderAttribution = handlers.folderAttribution?.(plan) ?? {
    scope: "unknown",
  };
  if (attribution.scope === "outside-folders") {
    return refused(
      "this mutation does not target a folder (an org-level or root-level resource), and this connection's folderAllowlist admits only writes inside the listed folders",
    );
  }
  // An EMPTY `folders` list would satisfy "every attributed folder is a
  // member" vacuously — the empty-quantifier hole — so it is folded into the
  // unattributable case rather than admitted.
  if (attribution.scope === "unknown" || attribution.folders.length === 0) {
    return refused(
      "this connection declares a folderAllowlist but its provider cannot attribute this mutation to a folder, so it cannot be admitted",
    );
  }
  if (attribution.folders.every((folder) => folderAllowlist.includes(folder))) return undefined;
  return refused(
    "this mutation targets a folder outside this connection's folderAllowlist (every attributed folder must be a member)",
  );
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
  // DEFECT 21 — first statement, ahead of everything: ahead of the
  // idempotency-key mutex, ahead of the journal query, ahead of
  // `persistRecord(pending)`, ahead of any network I/O.
  //
  // RULING — the refusal is deliberately NOT JOURNALLED, and this is a
  // decision, not an omission. A persisted `failed` record is authoritative
  // and terminal in this pipeline (`executeMutationPlanLocked` returns
  // "previously recorded as <status>, never re-run" for one), so recording
  // this refusal would poison the plan's `idempotencyKey` forever: an
  // operator who then FIXED the allowlist could never retry the same key.
  // The opposite case, for contrast: a `failed` record from
  // `applyVerifyRecord` IS written, because there a network attempt actually
  // happened and exactly-once bookkeeping has something to remember. Here
  // nothing was attempted, so there is nothing to record — the refusal still
  // reaches the caller as a typed outcome. Pinned by the retry-after-config-
  // fix test in `./mutation-pipeline.test.ts`; if you are here to "fix" the
  // missing journal write, that test is the reason not to.
  //
  // Being ahead of the replay/conflict lookups is also deliberate: after an
  // allowlist is tightened, even a replay of an already-recorded operation
  // for an out-of-allowlist tenant is refused. Fail-closed.
  const refusal = refuseOutOfAllowlistTenant(plan, deps.tenantAllowlist);
  if (refusal !== undefined) return refusal;

  // DEFECT 16 — the folder-allowlist check sits immediately after the tenant
  // one and shares every property of its placement (ahead of the lock, the
  // journal query, `persistRecord(pending)` and all network I/O; ahead of
  // the replay/conflict lookups, so tightening an allowlist also refuses a
  // replay). ORDER IS DELIBERATE, not incidental: a plan outside BOTH
  // allowlists is reported as a tenant refusal, because tenancy is the
  // coarser scope and the likelier misconfiguration. Pinned by the
  // "reports the TENANT refusal when a plan is outside both allowlists"
  // case in `./mutation-pipeline.test.ts` — which also proves neither check
  // absorbed the other's coverage.
  const folderRefusal = refuseOutOfAllowlistFolder(plan, deps.folderAllowlist, handlers);
  if (folderRefusal !== undefined) return folderRefusal;

  return deps.lock.runExclusive(plan.idempotencyKey, () =>
    executeMutationPlanLocked(plan, handlers, deps),
  );
}
