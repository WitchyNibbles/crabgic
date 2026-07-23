/**
 * Forwarded `run.status`/`run.cancel` native tools — roadmap/16-gateway-
 * core.md §In scope: "forwards `run.status`/`run.cancel` over UDS to 05's
 * own router... never a second implementation of those two." One
 * (forwarded) family of the 8-family MCP tool surface.
 */

import { z } from "zod";
import { forwardToSupervisor } from "../uds-forward-client.js";
import type { AnyGatewayToolDefinition, GatewayToolDefinition } from "../tool-registry.js";

export interface RunForwardToolsDeps {
  readonly supervisorSocketPath: string;
}

const RUN_STATUS_INPUT_SHAPE = { runId: z.string() };
const RUN_CANCEL_INPUT_SHAPE = { runId: z.string(), reason: z.string().optional() };

export function buildRunForwardTools(
  deps: RunForwardToolsDeps,
): readonly AnyGatewayToolDefinition[] {
  const status: GatewayToolDefinition<typeof RUN_STATUS_INPUT_SHAPE> = {
    name: "run.status",
    description: "Forwards to 05's supervisor `run.status` router operation over UDS.",
    inputSchema: RUN_STATUS_INPUT_SHAPE,
    handler: async (args) => {
      const response = await forwardToSupervisor(deps.supervisorSocketPath, "run.status", args);
      return {
        content: [
          { type: "text", text: JSON.stringify(response.ok ? response.result : response.error) },
        ],
        ...(response.ok ? {} : { isError: true }),
      };
    },
  };

  const cancel: GatewayToolDefinition<typeof RUN_CANCEL_INPUT_SHAPE> = {
    name: "run.cancel",
    description: "Forwards to 05's supervisor `run.cancel` router operation over UDS.",
    inputSchema: RUN_CANCEL_INPUT_SHAPE,
    handler: async (args) => {
      const response = await forwardToSupervisor(deps.supervisorSocketPath, "run.cancel", args);
      return {
        content: [
          { type: "text", text: JSON.stringify(response.ok ? response.result : response.error) },
        ],
        ...(response.ok ? {} : { isError: true }),
      };
    },
  };

  return [status, cancel];
}
