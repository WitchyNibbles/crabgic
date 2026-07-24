/**
 * Extensible MCP tool registry — RELOCATED to `@eo/contracts` (2026-07-25)
 * and re-exported here verbatim.
 *
 * The implementation now lives at
 * `packages/contracts/src/gateway/tool-registry.ts`, beside the
 * `GATEWAY_MCP_SERVER_NAME` it is hosted under; see that file's own doc
 * comment for the roadmap/09 provenance and for why it had to move (phase
 * 12 registers its `capability.*` tools into this registry "with no new
 * dependency edge", which reaching the type from here made impossible —
 * it closed a `cli -> learning -> gates -> detect -> cli` cycle).
 *
 * Kept as a named re-export so every existing `./registry.js` /
 * `../gateway-mcp/registry.js` import in this package and the published
 * `engineering-orchestrator` surface are both unchanged.
 */
export { createToolRegistry, DuplicateToolError } from "@eo/contracts";
export type { McpToolDefinition, McpToolRegistry } from "@eo/contracts";
