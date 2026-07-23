/**
 * `tracker.*` native tools — roadmap/16-gateway-core.md §In scope: "natively
 * registers `tracker.search/get/plan_create/plan_update/plan_transition/
 * plan_comment/apply`... wired to items 1-4." One family (7 leaves) of the
 * 8-family MCP tool surface (interface-ledger Gap 1).
 *
 * `tracker.apply` is built separately from the other 6 read/plan tools
 * (HIGH #2 adversarial-review fix) — it is the ONE mutating tool in this
 * family, routed through `./mutation-apply-tool.js`'s
 * `buildMutationApplyTool`, which is the sole caller of the exactly-once,
 * SSRF-hardened `../../mutation-pipeline/mutation-pipeline.js`. It is
 * never dispatched through `./provider-dispatch-tool.js`'s generic,
 * read-only `client[operation](params)` call — that path has no journal-
 * before-I/O, no idempotency, no SSRF guard, and must never carry a
 * mutating verb.
 */

import { buildProviderDispatchTool, type ProviderDispatchDeps } from "./provider-dispatch-tool.js";
import { buildMutationApplyTool, type MutationApplyToolDeps } from "./mutation-apply-tool.js";
import type { AnyGatewayToolDefinition } from "../tool-registry.js";

const TRACKER_READ_AND_PLAN_TOOLS: ReadonlyArray<readonly [name: string, description: string, operation: string]> = [
  ["tracker.search", "Searches tracker items (e.g. Jira issues) for a connection.", "search"],
  ["tracker.get", "Reads one tracker item by canonical target.", "get"],
  ["tracker.plan_create", "Plans a tracker item creation (no network I/O yet).", "planCreate"],
  ["tracker.plan_update", "Plans a tracker item field update.", "planUpdate"],
  ["tracker.plan_transition", "Plans a tracker item workflow transition.", "planTransition"],
  ["tracker.plan_comment", "Plans a tracker item comment.", "planComment"],
];

export function buildTrackerTools(
  deps: ProviderDispatchDeps & MutationApplyToolDeps,
): readonly AnyGatewayToolDefinition[] {
  const readAndPlanTools = TRACKER_READ_AND_PLAN_TOOLS.map(([name, description, operation]) =>
    buildProviderDispatchTool(name, description, operation, deps),
  );
  const applyTool = buildMutationApplyTool(
    "tracker.apply",
    "Executes an already-validated tracker RemoteMutationPlan through the exactly-once, SSRF-hardened mutation pipeline.",
    deps,
  );
  return [...readAndPlanTools, applyTool];
}
