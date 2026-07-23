/**
 * `observability.*` native tools — roadmap/16-gateway-core.md §In scope:
 * "natively registers... `observability.search/get/query/plan_create/
 * plan_update/apply`... wired to items 1-4." One family (5 read/plan
 * leaves + 1 mutating leaf) of the 8-family MCP tool surface
 * (interface-ledger Gap 1).
 *
 * `observability.apply` is built separately (HIGH #2 adversarial-review
 * fix) — see `./tracker-tools.js`'s identical split for the rationale.
 */

import { buildProviderDispatchTool, type ProviderDispatchDeps } from "./provider-dispatch-tool.js";
import { buildMutationApplyTool, type MutationApplyToolDeps } from "./mutation-apply-tool.js";
import type { AnyGatewayToolDefinition } from "../tool-registry.js";

const OBSERVABILITY_READ_AND_PLAN_TOOLS: ReadonlyArray<
  readonly [name: string, description: string, operation: string]
> = [
  [
    "observability.search",
    "Searches observability resources (e.g. Grafana dashboards) for a connection.",
    "search",
  ],
  ["observability.get", "Reads one observability resource by canonical target.", "get"],
  [
    "observability.query",
    "Executes a read-only observability query (e.g. a Grafana datasource query).",
    "query",
  ],
  ["observability.plan_create", "Plans an observability resource creation.", "planCreate"],
  ["observability.plan_update", "Plans an observability resource update.", "planUpdate"],
];

export function buildObservabilityTools(
  deps: ProviderDispatchDeps & MutationApplyToolDeps,
): readonly AnyGatewayToolDefinition[] {
  const readAndPlanTools = OBSERVABILITY_READ_AND_PLAN_TOOLS.map(([name, description, operation]) =>
    buildProviderDispatchTool(name, description, operation, deps),
  );
  const applyTool = buildMutationApplyTool(
    "observability.apply",
    "Executes an already-validated observability RemoteMutationPlan through the exactly-once, SSRF-hardened mutation pipeline.",
    deps,
  );
  return [...readAndPlanTools, applyTool];
}
