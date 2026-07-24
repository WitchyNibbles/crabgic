/**
 * `project.inspect` / `contract.approve` MCP tool descriptors —
 * roadmap/11-intake-contract-approval.md §Interfaces produced item 1: wire
 * names `mcp__${GATEWAY_MCP_SERVER_NAME}__project.inspect`,
 * `mcp__${GATEWAY_MCP_SERVER_NAME}__contract.approve`. Mirrors
 * `packages/detect/src/mcp/tool-definitions.ts`'s own established
 * convention verbatim: this module owns only the tool DESCRIPTORS +
 * registration into 09's `McpToolRegistry`; the actual handler logic lives
 * in `./project-inspect-handler.ts` / `./contract-approve-handler.ts` as
 * plain exported functions, ready to be wired to a real `tools/call`
 * dispatcher once 09 implements one (09's `gateway-mcp/stdio-server.ts`
 * currently implements `tools/list` only — see that module's own doc
 * comment).
 */
import type { McpToolDefinition, McpToolRegistry } from "../gateway-mcp/registry.js";

export const PROJECT_INSPECT_TOOL: McpToolDefinition = {
  name: "project.inspect",
  description:
    "Read-only repo/stack/connection/ChangeSet-state summary. Reads 07's journaled git_freeze record and 12's StackEvidence when present, degrading gracefully before either exists. Also answers ChangeSet-state queries — the sole ChangeSet-state read surface in this system.",
  inputSchema: {
    type: "object",
    properties: {
      changeSetId: { type: "string" },
    },
  },
};

export const CONTRACT_APPROVE_TOOL: McpToolDefinition = {
  name: "contract.approve",
  description:
    "Verifies a previously supervisor-minted approval token bound to an AuthorizationEnvelope's canonical hash and, on success, transitions the named ChangeSet from awaiting_approval to ready. Never model-satisfiable — fails closed with no pre-minted token, a mismatched digest, an expired token, or a replayed one.",
  inputSchema: {
    type: "object",
    properties: {
      changeSetId: { type: "string" },
      digest: { type: "string" },
      token: { type: "string" },
    },
    required: ["changeSetId", "digest", "token"],
  },
};

/** Registers both tools into `registry` — throws `DuplicateToolError` (09's own registry) if either name is already registered. */
export function registerIntakeTools(registry: McpToolRegistry): void {
  registry.register(PROJECT_INSPECT_TOOL);
  registry.register(CONTRACT_APPROVE_TOOL);
}
