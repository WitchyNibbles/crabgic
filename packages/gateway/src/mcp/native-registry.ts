/**
 * Assembles this phase's full native tool set into one `GatewayToolRegistry`
 * — roadmap/16-gateway-core.md §In scope, "Sole MCP host & extensible
 * tool-registration API": "natively registers `tracker.*`,
 * `observability.*`, `evidence.get`, `evidence.attach`, `result.submit`,
 * and forwards `run.status`/`run.cancel`... the registry surface 11/12
 * later populate." Work item 5.
 */

import type { JournalStore } from "@eo/journal";
import type { ExternalConnectionRepository } from "../connection-store/external-connection-store.js";
import { ProviderRegistry } from "../provider-dispatch/provider-registry.js";
import { IdempotencyKeyLock } from "../mutation-pipeline/mutation-pipeline.js";
import { GatewayToolRegistry } from "./tool-registry.js";
import { buildTrackerTools } from "./native-tools/tracker-tools.js";
import { buildObservabilityTools } from "./native-tools/observability-tools.js";
import { buildEvidenceTools } from "./native-tools/evidence-tools.js";
import { buildResultTools } from "./native-tools/result-tools.js";
import { buildRunForwardTools } from "./native-tools/run-forward-tools.js";
import type { GenericProviderClient } from "./native-tools/provider-dispatch-tool.js";
import type { MutationApplyClient } from "./native-tools/mutation-apply-client.js";
import type { MutationApplyToolDeps } from "./native-tools/mutation-apply-tool.js";

export interface NativeRegistryDeps {
  readonly connections: ExternalConnectionRepository;
  readonly providers: ProviderRegistry<GenericProviderClient>;
  /** The provider-dispatch point specifically for mutating `*.apply` tools (HIGH #2 adversarial-review fix) — distinct from `providers`, since a mutation's own network I/O is never issued by the provider client itself, only by `executeMutationPlan`. */
  readonly mutationApplyClients: ProviderRegistry<MutationApplyClient>;
  readonly journal: JournalStore;
  readonly supervisorSocketPath: string;
  /** Test-only seam, forwarded verbatim to `./native-tools/mutation-apply-tool.js`'s `buildMutationApplyTool` — see that module's own doc comment. */
  readonly buildHttpClient?: MutationApplyToolDeps["buildHttpClient"];
}

/**
 * The exact native tool-name set this phase registers — the golden list
 * every registry-completeness/leak-hunt/grep exit-criterion test compares
 * against. `tracker.*` (7) + `observability.*` (6) + `evidence.*` (2) +
 * `result.submit` (1) + forwarded `run.*` (2) = 18 individual tool names
 * across the 8 families interface-ledger Gap 1 counts.
 */
export function buildNativeToolRegistry(deps: NativeRegistryDeps): GatewayToolRegistry {
  const registry = new GatewayToolRegistry();

  // ONE lock instance shared across every mutating tool call this
  // registry serves — MEDIUM #5's per-idempotencyKey serialization only
  // works if concurrent calls for the same key actually contend on the
  // SAME lock instance, not a fresh one per call.
  const lock = new IdempotencyKeyLock();

  const providerDispatchDeps = { connections: deps.connections, providers: deps.providers };
  const mutationApplyToolDeps: MutationApplyToolDeps = {
    connections: deps.connections,
    mutationApplyClients: deps.mutationApplyClients,
    journal: deps.journal,
    lock,
    ...(deps.buildHttpClient !== undefined ? { buildHttpClient: deps.buildHttpClient } : {}),
  };
  const trackerDeps = { ...providerDispatchDeps, ...mutationApplyToolDeps };
  const observabilityDeps = { ...providerDispatchDeps, ...mutationApplyToolDeps };

  for (const tool of buildTrackerTools(trackerDeps)) registry.register(tool);
  for (const tool of buildObservabilityTools(observabilityDeps)) registry.register(tool);
  for (const tool of buildEvidenceTools({ journal: deps.journal })) registry.register(tool);
  for (const tool of buildResultTools({ journal: deps.journal })) registry.register(tool);
  for (const tool of buildRunForwardTools({ supervisorSocketPath: deps.supervisorSocketPath })) {
    registry.register(tool);
  }

  return registry;
}
