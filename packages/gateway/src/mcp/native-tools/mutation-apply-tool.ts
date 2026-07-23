/**
 * `tracker.apply`/`observability.apply` tool factory (HIGH #2 adversarial-
 * review fix) — routes EVERY mutating MCP tool call through
 * `../../mutation-pipeline/mutation-pipeline.js`'s `executeMutationPlan`,
 * which is the sole issuer of the actual network I/O (via
 * `../../connection-store/connection-http-client.js`'s connection-scoped
 * `GatewayHttpClient`). No code path can construct a mutating tool that
 * skips the journal-before-I/O / exactly-once / SSRF-guarded pipeline —
 * unlike the read-only `tracker.*`/`observability.*` tools
 * (`./provider-dispatch-tool.js`), which never mutate and so never need
 * this pipeline.
 */

import { ConnectorError, RemoteMutationPlanSchema, type ExternalConnection } from "@eo/contracts";
import type { JournalStore } from "@eo/journal";
import { buildHttpClientForConnection } from "../../connection-store/connection-http-client.js";
import type { ExternalConnectionRepository } from "../../connection-store/external-connection-store.js";
import type { GatewayHttpClient } from "../../transport/http-client.js";
import {
  executeMutationPlan,
  type IdempotencyKeyLock,
  type MutationPipelineHandlers,
  type MutationPipelineOutcome,
} from "../../mutation-pipeline/mutation-pipeline.js";
import { ProviderRegistry, UnknownProviderError } from "../../provider-dispatch/provider-registry.js";
import type { GatewayToolDefinition, GatewayToolResult } from "../tool-registry.js";
import type { MutationApplyClient } from "./mutation-apply-client.js";

export interface MutationApplyToolDeps {
  readonly connections: ExternalConnectionRepository;
  readonly mutationApplyClients: ProviderRegistry<MutationApplyClient>;
  readonly journal: JournalStore;
  readonly lock: IdempotencyKeyLock;
  /** Test-only seam (mirrors `../../connection-doctor/reachability-probe.js`'s own `buildClient` override) — production always omits this, defaulting to `buildHttpClientForConnection` (real DNS, real TLS). */
  readonly buildHttpClient?: (connection: ExternalConnection) => Promise<GatewayHttpClient>;
}

const APPLY_INPUT_SHAPE = { plan: RemoteMutationPlanSchema };

function errorResult(err: ConnectorError): GatewayToolResult {
  return { content: [{ type: "text", text: JSON.stringify(err.toData()) }], isError: true };
}

function outcomeToToolResult(outcome: MutationPipelineOutcome): GatewayToolResult {
  const isError = outcome.status !== "recorded" && outcome.status !== "replayed";
  return {
    content: [{ type: "text", text: JSON.stringify(outcome) }],
    ...(isError ? { isError: true } : {}),
  };
}

/** Builds one mutation-apply tool (`tracker.apply` or `observability.apply`). Its input is a full, schema-validated `RemoteMutationPlan` — "run ID, idempotency key, expected state version, envelope reference, and a validated plan" (roadmap/16 §In scope) are all REQUIRED fields on that schema already, never a loose `Record<string, unknown>` bag. */
export function buildMutationApplyTool(
  name: string,
  description: string,
  deps: MutationApplyToolDeps,
): GatewayToolDefinition<typeof APPLY_INPUT_SHAPE> {
  return {
    name,
    description,
    inputSchema: APPLY_INPUT_SHAPE,
    handler: async (args) => {
      const plan = args.plan;

      const connection = await deps.connections.get(plan.externalConnectionId);
      if (connection === undefined) {
        return errorResult(
          ConnectorError.notFound({
            message: `no such connection: ${plan.externalConnectionId}`,
            provider: "unknown",
            retryable: false,
          }),
        );
      }

      let applyClient: MutationApplyClient;
      try {
        applyClient = deps.mutationApplyClients.resolve(connection.provider);
      } catch (err) {
        if (err instanceof UnknownProviderError) {
          return errorResult(
            ConnectorError.unsupported({
              message: err.message,
              provider: connection.provider,
              retryable: false,
            }),
          );
        }
        throw err;
      }

      const httpClient = await (deps.buildHttpClient ?? buildHttpClientForConnection)(connection);
      const verify = applyClient.verify;
      const reconcileAmbiguous = applyClient.reconcileAmbiguous;
      const handlers: MutationPipelineHandlers = {
        provider: connection.provider,
        buildRequest: (p) => applyClient.buildRequest(p),
        parseResponse: (p, r) => applyClient.parseResponse(p, r),
        verify: verify !== undefined ? (p, a) => verify(p, a) : async () => true,
        ...(reconcileAmbiguous !== undefined
          ? { reconcileAmbiguous: (p: typeof plan, cause: unknown) => reconcileAmbiguous(p, cause) }
          : {}),
      };

      const outcome = await executeMutationPlan(plan, handlers, {
        journal: deps.journal,
        httpClient,
        lock: deps.lock,
      });
      return outcomeToToolResult(outcome);
    },
  };
}
