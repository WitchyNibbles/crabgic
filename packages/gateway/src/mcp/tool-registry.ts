/**
 * Extensible MCP tool-registration API — roadmap/16-gateway-core.md §In
 * scope, "Sole MCP host & extensible tool-registration API": "the same
 * registration API, not just these native families, is what 11
 * (`project.inspect`, `contract.approve`) and 12 (`capability.audit`,
 * `capability.approve`) plug their own already-built handlers into when
 * they land, with no new cross-phase dependency edge." Work item 5.
 *
 * Deliberately framework-light: a `GatewayToolDefinition` is a plain
 * name/description/zod-shape/handler tuple, independent of
 * `@modelcontextprotocol/sdk`'s own `McpServer.registerTool` config shape
 * — `./server.ts` is the one module that adapts entries in this registry
 * onto a real `McpServer` instance. Keeping the registry itself
 * SDK-agnostic is what makes "a duplicate-name registration attempt is
 * rejected before the check exists" (roadmap/16, work item 5) trivially
 * unit-testable with no MCP transport involved at all.
 */

import type { z } from "zod";

export interface GatewayToolTextContent {
  readonly type: "text";
  readonly text: string;
}

export interface GatewayToolResult {
  readonly content: readonly GatewayToolTextContent[];
  readonly isError?: boolean;
}

export type GatewayToolArgsShape = Record<string, z.ZodTypeAny>;

export type InferShape<TShape extends GatewayToolArgsShape> = {
  [K in keyof TShape]: z.infer<TShape[K]>;
};

export interface GatewayToolDefinition<TShape extends GatewayToolArgsShape = GatewayToolArgsShape> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: TShape;
  readonly handler: (args: InferShape<TShape>) => Promise<GatewayToolResult>;
}

/**
 * Type-erased alias for "a `GatewayToolDefinition` over some shape I no
 * longer need to track precisely" — the shape every builder module
 * (`../mcp/native-tools/*.ts`) returns its tool list as, and the shape
 * `GatewayToolRegistry` stores/lists internally. A specifically-shaped
 * `GatewayToolDefinition<TShape>` is deliberately NOT a structural subtype
 * of `GatewayToolDefinition<GatewayToolArgsShape>` (the handler parameter
 * position is contravariant), so heterogeneous tool lists need this
 * explicit erasure rather than relying on the default type parameter.
 * `any` (rather than `GatewayToolArgsShape`) is deliberate here — it is
 * the one type TS never applies contravariant-position variance checks
 * against, which is exactly the escape hatch this erasure needs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate type-erasure escape hatch, see doc comment above.
export type AnyGatewayToolDefinition = GatewayToolDefinition<any>;

export class DuplicateToolNameError extends Error {
  readonly toolName: string;

  constructor(toolName: string) {
    super(`gateway tool registry: a tool named "${toolName}" is already registered`);
    this.name = "DuplicateToolNameError";
    this.toolName = toolName;
    Object.freeze(this);
  }
}

/**
 * The one registry every native family (work item 5) and every later
 * external registrant (11's `project.inspect`/`contract.approve`, 12's
 * `capability.audit`/`capability.approve`) registers into. Booting against
 * an empty registry lists a well-formed, empty tool set without crashing
 * (roadmap/16, work item 5's own "failing-first" note) — this class's
 * default-constructed state already satisfies that.
 */
export class GatewayToolRegistry {
  readonly #tools = new Map<string, AnyGatewayToolDefinition>();

  register<TShape extends GatewayToolArgsShape>(definition: GatewayToolDefinition<TShape>): void {
    if (this.#tools.has(definition.name)) {
      throw new DuplicateToolNameError(definition.name);
    }
    this.#tools.set(definition.name, definition as AnyGatewayToolDefinition);
  }

  get(name: string): AnyGatewayToolDefinition | undefined {
    return this.#tools.get(name);
  }

  list(): readonly AnyGatewayToolDefinition[] {
    return [...this.#tools.values()];
  }

  get toolNames(): readonly string[] {
    return [...this.#tools.keys()];
  }
}
