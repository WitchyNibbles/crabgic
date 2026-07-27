/**
 * Gateway family-completeness audit — roadmap/23 work item 7's "is every
 * MCP tool family the ledger counts actually reachable from the shipped
 * binary?" check.
 *
 * HISTORY, because it explains this module's shape. When first written,
 * every one of the eight families was UNREACHABLE: `packages/cli` had no
 * `@crabgic/gateway` dependency edge at all, `cli-entry.ts`'s `gateway mcp` boot
 * created an empty registry, and the hand-rolled stdio server answered
 * `tools/call` with METHOD_NOT_FOUND unconditionally. The audit could
 * therefore only ENUMERATE the gap, which it did by grepping
 * `cli-entry.ts`'s source for each family's builder identifier.
 *
 * That static grep is now the wrong instrument (2026-07-25). The families
 * are wired through a composition root — `buildRealGatewayToolRegistry` —
 * so no builder identifier appears in `cli-entry.ts` at all, and a source
 * scan would report a false gap. More importantly, a grep never proved
 * reachability in the first place: an identifier can appear in a comment,
 * or be called on a branch that never runs. This module now BUILDS the real
 * production registry and asks it what it actually contains, and boots a
 * real MCP server to invoke a real tool. Both are behavioural.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
// BOTH from the published barrel, deliberately. `GatewayToolRegistry` is a
// class with a `#private` field, so the declaration bundled into `crabgic`
// and `@crabgic/gateway`'s own are nominally distinct — mixing the two
// sources here failed with "Property '#private' … refers to a different
// member". Taking the pair from one module is also what a real consumer of
// the published package must do.
import { buildRealGatewayToolRegistry, connectGatewayMcpStdio } from "crabgic";

export type GatewayFamily =
  | "tracker"
  | "observability"
  | "evidence"
  | "result"
  | "run-forward"
  | "project-inspect"
  | "contract-approve"
  | "capability-audit-approve";

export interface FamilyWiringResult {
  readonly family: GatewayFamily;
  readonly toolNames: readonly string[];
  readonly wiredAtProductionEntrypoint: boolean;
  readonly ownerPhase: string;
  /** Tool names this family declares that the real production registry does NOT contain — empty when the family is fully wired. */
  readonly missingToolNames: readonly string[];
}

/**
 * The 8 families and the tool names each contributes (interface-ledger Gap
 * 1's settled count: 18 native leaves + 11's two + 12's two).
 *
 * These are the names the CODE registers, verified against the real
 * registry. An earlier revision of this list was transcribed from roadmap
 * prose and had drifted from the implementation (`tracker.create` for
 * `tracker.plan_create`, `observability.plan_alert` for
 * `observability.search`, and so on) — harmless while every family was
 * reported missing anyway, actively misleading now that the check passes.
 */
const FAMILY_SPECS: readonly Omit<
  FamilyWiringResult,
  "wiredAtProductionEntrypoint" | "missingToolNames"
>[] = [
  {
    family: "tracker",
    toolNames: [
      "tracker.search",
      "tracker.get",
      "tracker.plan_create",
      "tracker.plan_update",
      "tracker.plan_transition",
      "tracker.plan_comment",
      "tracker.apply",
    ],
    ownerPhase: "16",
  },
  {
    family: "observability",
    toolNames: [
      "observability.search",
      "observability.get",
      "observability.query",
      "observability.plan_create",
      "observability.plan_update",
      "observability.apply",
    ],
    ownerPhase: "16",
  },
  { family: "evidence", toolNames: ["evidence.get", "evidence.attach"], ownerPhase: "16" },
  { family: "result", toolNames: ["result.submit"], ownerPhase: "16" },
  { family: "run-forward", toolNames: ["run.status", "run.cancel"], ownerPhase: "16" },
  { family: "project-inspect", toolNames: ["project.inspect"], ownerPhase: "11" },
  { family: "contract-approve", toolNames: ["contract.approve"], ownerPhase: "11" },
  {
    family: "capability-audit-approve",
    toolNames: ["capability.audit", "capability.approve"],
    ownerPhase: "12",
  },
];

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLI_PACKAGE_JSON_PATH = join(
  HERE,
  "..",
  "..",
  "..",
  "packages",
  "cli",
  "package.json",
);

/** Builds the real production registry against a throwaway state root, so the audit never reads or writes the operator's own project state. */
function withThrowawayRegistry<T>(use: (toolNames: ReadonlySet<string>) => T): T {
  const home = mkdtempSync(join(tmpdir(), "eo-family-audit-"));
  try {
    const registry = buildRealGatewayToolRegistry({
      xdgEnv: { HOME: home },
      projectHash: "family-completeness-audit",
    });
    return use(new Set(registry.toolNames));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * Builds the REAL production tool registry — the exact one `gateway mcp`
 * boots — and reports, per family, whether every tool name it declares is
 * actually registered.
 */
export function checkFamilyWiringAtProductionEntrypoint(): readonly FamilyWiringResult[] {
  return withThrowawayRegistry((registered) =>
    FAMILY_SPECS.map((spec) => {
      const missingToolNames = spec.toolNames.filter((name) => !registered.has(name));
      return {
        ...spec,
        missingToolNames,
        wiredAtProductionEntrypoint: missingToolNames.length === 0,
      };
    }),
  );
}

/** Reads `packages/cli/package.json`'s own dependency graph and reports whether it declares `@crabgic/gateway` — the edge without which no native family could be imported at all. */
export function checkGatewayDependencyEdge(
  cliPackageJsonPath: string = DEFAULT_CLI_PACKAGE_JSON_PATH,
): { readonly hasGatewayDependency: boolean } {
  const manifest = JSON.parse(readFileSync(cliPackageJsonPath, "utf8")) as {
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
  };
  const hasGatewayDependency =
    "@crabgic/gateway" in (manifest.dependencies ?? {}) ||
    "@crabgic/gateway" in (manifest.devDependencies ?? {});
  return { hasGatewayDependency };
}

export interface ToolsCallSupportResult {
  readonly supported: boolean;
  readonly evidence: string;
}

export interface RawJsonRpcResponse {
  readonly error?: { readonly code: number; readonly message: string };
  readonly result?: unknown;
}

/**
 * Pure interpretation of a `tools/call` JSON-RPC response — split out from
 * the real-stdio plumbing below so both outcomes are directly unit-testable
 * without needing to fabricate a server in either state.
 */
export function interpretToolsCallResponse(response: RawJsonRpcResponse): ToolsCallSupportResult {
  if (response.error !== undefined) {
    return {
      supported: false,
      evidence: `"tools/call" returned a JSON-RPC error: ${response.error.message} (code ${String(response.error.code)}) — tool invocation is not implemented on this transport`,
    };
  }
  return {
    supported: true,
    evidence: `"tools/call" returned a real result: ${JSON.stringify(response.result)}`,
  };
}

/**
 * Behavioural proof that a worker can actually INVOKE a tool: boots the
 * real MCP stdio server over `PassThrough` streams (never real
 * `process.stdin`/`process.stdout`, so this can never block a test run),
 * completes the handshake the protocol requires, and calls a real
 * registered tool — `project.inspect`, chosen because it needs no external
 * connection and no pre-minted token.
 */
export async function checkToolsCallSupported(): Promise<ToolsCallSupportResult> {
  const home = mkdtempSync(join(tmpdir(), "eo-tools-call-audit-"));
  const input = new PassThrough();
  const output = new PassThrough();
  let server: Awaited<ReturnType<typeof connectGatewayMcpStdio>> | undefined;

  try {
    const registry = buildRealGatewayToolRegistry({
      xdgEnv: { HOME: home },
      projectHash: "tools-call-audit",
    });
    server = await connectGatewayMcpStdio(registry, { input, output });

    const response = await new Promise<RawJsonRpcResponse>((resolve) => {
      let buffer = "";
      output.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line.length > 0) {
            const message = JSON.parse(line) as RawJsonRpcResponse & { id?: unknown };
            if (message.id === 2) resolve(message);
          }
          newline = buffer.indexOf("\n");
        }
      });

      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "family-completeness-audit", version: "0.0.0" },
          },
        })}\n`,
      );
      input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "project.inspect", arguments: {} },
        })}\n`,
      );
    });

    return interpretToolsCallResponse(response);
  } finally {
    await server?.close();
    input.end();
    rmSync(home, { recursive: true, force: true });
  }
}
