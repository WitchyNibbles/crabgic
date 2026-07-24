/**
 * `capability.audit` / `capability.approve` MCP tool definitions —
 * roadmap/12 §Interfaces produced: "implementation stays in
 * `packages/detect` (unchanged: no relocation into `packages/gateway`).
 * Both register into the single `eo_gateway` tool registry
 * (`GATEWAY_MCP_SERVER_NAME`, 02) that phase 09's `gateway mcp` command
 * exposes — no new dependency edge, since this phase already depends on
 * 09." This module owns only the tool DESCRIPTORS + registration; the
 * actual handler logic lives in `./capability-audit-handler.ts` /
 * `./capability-approve-handler.ts` (09's own `McpToolRegistry`/stdio
 * server implements `tools/list` only, not `tools/call` dispatch yet — see
 * that package's `gateway-mcp/registry.ts` doc comment — so these handlers
 * are plain exported functions today, ready to be wired to a real
 * `tools/call` dispatcher once 09 implements one).
 */
import type { McpToolDefinition, McpToolRegistry } from "engineering-orchestrator";

export const CAPABILITY_AUDIT_TOOL: McpToolDefinition = {
  name: "capability.audit",
  description:
    "Runs the quarantine pipeline (fetch, pin, verify provenance, scan, sandbox-test) against a candidate capability descriptor and returns the resulting AuditReport, recording it in the content-addressed capability store.",
  inputSchema: {
    type: "object",
    properties: {
      candidate: { type: "object" },
    },
    required: ["candidate"],
  },
};

export const CAPABILITY_APPROVE_TOOL: McpToolDefinition = {
  name: "capability.approve",
  description:
    "Verifies a previously human-minted `trust approve` token bound to a capability's digest and, on success, flips its manifest entry's decision to approved. Never model-satisfiable — fails closed with no pre-minted token.",
  inputSchema: {
    type: "object",
    properties: {
      digest: { type: "string" },
      token: { type: "string" },
    },
    required: ["digest", "token"],
  },
};

/** Registers both tools into `registry` — throws `DuplicateToolError` (09's own registry) if either name is already registered. */
export function registerCapabilityTools(registry: McpToolRegistry): void {
  registry.register(CAPABILITY_AUDIT_TOOL);
  registry.register(CAPABILITY_APPROVE_TOOL);
}
