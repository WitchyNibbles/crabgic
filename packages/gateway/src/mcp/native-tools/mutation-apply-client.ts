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

import type { RemoteMutationPlan } from "@eo/contracts";
import type {
  MutationApplyResult,
  MutationHttpRequestSpec,
} from "../../mutation-pipeline/mutation-pipeline.js";
import type { HttpTransportResponse } from "../../transport/http-transport.js";

export interface MutationApplyClient {
  /** Builds the outbound HTTP request for this plan's mutation. Pure — no I/O of its own. */
  buildRequest(plan: RemoteMutationPlan): MutationHttpRequestSpec;
  /** Parses a successful (status < 400) HTTP response into the applied result. */
  parseResponse(plan: RemoteMutationPlan, response: HttpTransportResponse): MutationApplyResult;
  /** Read-back compare + verify. Defaults to "always verified" when omitted — a provider without a cheap read-back check may rely on the HTTP status alone; a real connector should supply a genuine check. */
  verify?(plan: RemoteMutationPlan, applied: MutationApplyResult): Promise<boolean>;
  /** Marker-reconciliation (see `../../mutation-pipeline/reconciliation.js`) — see `MutationPipelineHandlers.reconcileAmbiguous`'s own doc comment for the exact contract. */
  reconcileAmbiguous?(
    plan: RemoteMutationPlan,
    cause: unknown,
  ): Promise<MutationApplyResult | undefined>;
}
