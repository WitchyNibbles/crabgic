/**
 * `MutationApplyClient` — the provider-dispatch contract specifically for
 * a mutating `tracker.apply`/`observability.apply` MCP tool call (HIGH #2
 * adversarial-review fix). Distinct from `./provider-dispatch-tool.js`'s
 * `GenericProviderClient` (used for read/plan tools only): a mutation's
 * network I/O is never issued by the provider client itself — only
 * `../../mutation-pipeline/mutation-pipeline.js`'s `executeMutationPlan`
 * ever calls `deps.httpClient.request(...)`, so every mutating tool is
 * exactly-once and SSRF-hardened by construction, never by a provider
 * client's own discipline. 18's `JiraResourceClient` and 20's
 * `GrafanaProviderAdapter` implement this per their own remote's request/
 * response shape and marker-reconciliation mechanism.
 */

import type { RemoteMutationPlan } from "@crabgic/contracts";
import type {
  MutationApplyResult,
  MutationFolderAttribution,
  MutationHttpRequestSpec,
} from "../../mutation-pipeline/mutation-pipeline.js";
import type { HttpTransportResponse } from "../../transport/http-transport.js";

export interface MutationApplyClient {
  /** Builds the outbound HTTP request for this plan's mutation. Pure — no I/O of its own. */
  buildRequest(plan: RemoteMutationPlan): MutationHttpRequestSpec;
  /**
   * Resolves the authorization header(s) this plan's write must carry.
   *
   * SEPARATE FROM `buildRequest` BECAUSE `buildRequest` IS SYNCHRONOUS,
   * and that is not incidental — it is why writes were unauthenticated.
   * Resolving a secret reference is async, so no connector could attach a
   * credential inside `buildRequest`; every connector accordingly
   * returned `content-type` and nothing else, and nothing downstream
   * added anything, so every `*.apply` call reached the provider with no
   * credential at all while the read path authenticated correctly (issue
   * #135, defect 5). An async hook is the smallest shape that lets a
   * connector answer.
   *
   * Applied by `../../mutation-pipeline/mutation-pipeline.js` — the sole
   * issuer of mutating network I/O — AFTER the spec's own headers, so a
   * connector cannot accidentally downgrade its own credential.
   *
   * OPTIONAL only so a provider whose transport authenticates by other
   * means (a client certificate, a pre-authenticated proxy) can say so by
   * omission. Both shipped connectors implement it; a connector that
   * omits it sends no credential, which is a decision its own code should
   * make explicitly rather than inherit.
   */
  authHeaders?(plan: RemoteMutationPlan): Promise<Readonly<Record<string, string>>>;
  /** Parses a successful (status < 400) HTTP response into the applied result. */
  parseResponse(plan: RemoteMutationPlan, response: HttpTransportResponse): MutationApplyResult;
  /** Read-back compare + verify. Defaults to "always verified" when omitted — a provider without a cheap read-back check may rely on the HTTP status alone; a real connector should supply a genuine check. */
  verify?(plan: RemoteMutationPlan, applied: MutationApplyResult): Promise<boolean>;
  /** Serialization-ONLY key (or, for a write over several named resources such as 18/19's `bulk:<keys>`, key SET) for 16's per-tenant+resource write mutex — see `MutationPipelineHandlers.serializationTarget`'s own doc comment for the exact contract. Forwarded to the pipeline by `./mutation-apply-tool.ts`. */
  serializationTarget?(plan: RemoteMutationPlan): string | readonly string[];
  /** Where this mutation lands in folder terms, for `ExternalConnection.folderAllowlist` (DEFECT 16) — see `MutationPipelineHandlers.folderAttribution`'s own doc comment for the exact contract, including why ABSENT is not "admit everything". Forwarded to the pipeline by `./mutation-apply-tool.ts`. */
  folderAttribution?(plan: RemoteMutationPlan): MutationFolderAttribution;
  /** Marker-reconciliation (see `../../mutation-pipeline/reconciliation.js`) — see `MutationPipelineHandlers.reconcileAmbiguous`'s own doc comment for the exact contract. */
  reconcileAmbiguous?(
    plan: RemoteMutationPlan,
    cause: unknown,
  ): Promise<MutationApplyResult | undefined>;
}
