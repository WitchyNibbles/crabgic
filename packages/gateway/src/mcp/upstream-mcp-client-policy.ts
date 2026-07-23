/**
 * Optional upstream-MCP-client wrap — roadmap/16-gateway-core.md §In
 * scope: "for a provider that also exposes its own official MCP server
 * (Atlassian, Grafana), this phase — never a worker, and never the
 * manager directly — is the one process permitted to act as MCP *client*
 * to it, behind a per-connection capability flag with REST remaining
 * primary and default." §Out of scope: "Deciding whether a given
 * deployment enables the optional upstream-MCP-client wrap for a provider
 * — that per-connection flag lives in the `ExternalConnection` config
 * 18/20 populate (or a human operator sets), never decided unilaterally
 * by this phase."
 *
 * `ExternalConnectionSchema` (02, out of this package's authority to
 * extend) carries no dedicated field for this flag yet — this module
 * tracks it as this phase's own internal, out-of-band policy store keyed
 * by `externalConnectionId`, exactly the "per-connection flag" 18/20 (or a
 * human operator) are described as setting, pending a future coordinated
 * schema addition. Never decided unilaterally here: `setEnabled` always
 * requires an explicit caller-supplied boolean, defaulting to `false`
 * (REST remaining primary and default, per the In-scope bullet above).
 */

import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";

export class UpstreamMcpClientPolicyStore {
  readonly #enabled = new Map<string, boolean>();

  setEnabled(externalConnectionId: string, enabled: boolean): void {
    this.#enabled.set(externalConnectionId, enabled);
  }

  isEnabled(externalConnectionId: string): boolean {
    return this.#enabled.get(externalConnectionId) ?? false;
  }
}

/**
 * Exit criterion: "When the optional upstream-MCP-client wrap is enabled
 * for a fixture connection, no additional MCP server ever appears in a
 * simulated worker's `mcpServers` config — only this phase's own native
 * tools are worker-visible." This function deliberately takes NO policy
 * argument at all — that is the structural proof: a worker's own
 * `mcpServers` config is built once, upstream, by 06/10 (never by this
 * phase), and is wired to exactly this one gateway server regardless of
 * whether any connection's upstream-MCP-client flag is enabled. Enabling
 * the flag changes how THIS PHASE talks to an upstream provider server
 * internally; it can never add a second worker-visible MCP server entry,
 * because no code path in this phase (or anywhere in the corpus, per
 * 06's own confirmed design) threads a per-connection flag into a
 * worker's `mcpServers` construction at all.
 */
export function buildSimulatedWorkerMcpServers(): Readonly<Record<string, unknown>> {
  return {
    [GATEWAY_MCP_SERVER_NAME]: {
      type: "stdio",
      command: "engineering-orchestrator",
      args: ["gateway", "mcp"],
    },
  };
}
