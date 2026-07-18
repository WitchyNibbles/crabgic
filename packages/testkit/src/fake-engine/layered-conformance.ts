import type { AdjudicationCallback, CompiledWorkerProfile } from "@eo/engine-core";
import { evaluateAdjudicationLayer } from "./adjudication-layer.js";
import {
  evaluatePermissionLayer,
  permissionProfileToRuleSet,
  type PermissionRuleSet,
} from "./permission-evaluator.js";
import { evaluateSandboxLayer } from "./sandbox-evaluator.js";
import type { FakeToolCall } from "./tool-call.js";

/**
 * Combines layers 2-4 (adaptation §5.1/§9; roadmap/03-envelope-compiler-
 * engine-adapter.md work item 6: "expected allow/deny verdict at EACH of
 * layers 2-4 ... each layer independently assertable by disabling the
 * others"). Each layer's own function (imported above) IS the "disabled
 * others" isolation mechanism — call it directly to assert one layer alone;
 * `evaluateAllLayers` shows the combined defense-in-depth result a real
 * spawn would observe.
 */
export interface LayerVerdicts {
  readonly permissions: "allow" | "deny";
  readonly adjudication: "allow" | "deny";
  readonly sandbox: "allow" | "deny";
}

export interface CombinedVerdict extends LayerVerdicts {
  readonly overall: "allow" | "deny";
}

export async function evaluateAllLayers(
  profile: CompiledWorkerProfile,
  call: FakeToolCall,
  adjudicate: AdjudicationCallback | undefined,
  permissionRules: PermissionRuleSet = permissionProfileToRuleSet(profile.permissions),
): Promise<CombinedVerdict> {
  const permissions = evaluatePermissionLayer(permissionRules, call);
  const sandbox = evaluateSandboxLayer(profile.sandbox, call);
  const adjudication = await evaluateAdjudicationLayer(adjudicate, call);
  const overall =
    permissions === "allow" && sandbox === "allow" && adjudication === "allow" ? "allow" : "deny";
  return { permissions, adjudication, sandbox, overall };
}
