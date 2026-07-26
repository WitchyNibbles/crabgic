/**
 * Extensible MCP tool registry — roadmap/09-cli-and-doctor.md §Interfaces
 * produced item 3: "the stdio process this command boots exposes a tool
 * registry; 16's native families populate it, 11 registers
 * `project.inspect`/`contract.approve` into it, 12 registers
 * `capability.audit`/`capability.approve` into it, each at its own build
 * time with no new dependency edge for 11/12." Work item 2's failing-first
 * framing: "booting against an empty registry lists zero tools without
 * crashing; registering a fake tool makes it visible over stdio to a stub
 * MCP client; a duplicate tool-name registration is rejected." This module
 * owns only the registry data structure — `crabgic`'s
 * `gateway-mcp/stdio-server.ts` is the thing that boots it over stdio.
 *
 * WHY THIS LIVES IN `@crabgic/contracts` (2026-07-25): the quoted "no new
 * dependency edge for 11/12" is precisely what forced the relocation.
 * Phase 12 (`packages/detect`) registers its two `capability.*` tools into
 * this registry, and reaching the type from the CLI package closed a cycle
 * (`cli -> learning -> gates -> detect -> cli`) that made `tsc -b` fail
 * from a clean checkout. At the dependency-graph root every phase can
 * register into the one registry with no edge at all, which is what the
 * roadmap asked for. It sits beside `./server-name.ts` — the
 * `GATEWAY_MCP_SERVER_NAME` this registry is hosted under. The CLI
 * re-exports all four names verbatim, so the published
 * `crabgic` surface is unchanged.
 */

/** A minimal MCP tool descriptor — name, human description, and a JSON-schema-shaped input schema (never validated/executed here; this phase never implements a tool's own handler, per roadmap/09 §Out of scope). */
export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export class DuplicateToolError extends Error {
  constructor(name: string) {
    super(`gateway mcp: tool "${name}" is already registered`);
    this.name = "DuplicateToolError";
  }
}

export interface McpToolRegistry {
  /** Throws `DuplicateToolError` for a name already registered — every tool name is registered exactly once for this registry's lifetime. */
  register(tool: McpToolDefinition): void;
  /** Every registered tool, in registration order. Empty for a freshly-created registry — never a throw. */
  list(): readonly McpToolDefinition[];
  get(name: string): McpToolDefinition | undefined;
}

export function createToolRegistry(): McpToolRegistry {
  const tools = new Map<string, McpToolDefinition>();
  return {
    register(tool) {
      if (tools.has(tool.name)) {
        throw new DuplicateToolError(tool.name);
      }
      tools.set(tool.name, tool);
    },
    list() {
      return [...tools.values()];
    },
    get(name) {
      return tools.get(name);
    },
  };
}
