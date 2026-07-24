import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createToolRegistry,
  startGatewayMcpServer,
  type GatewayMcpServerHandle,
} from "engineering-orchestrator";

/**
 * Gateway MCP 8-family completeness check — roadmap/23-release-hardening.md
 * work item 7: "full 8-family gateway MCP tool-surface completeness — zero
 * `NOT_IMPLEMENTED` remaining across 09's CLI and 16's gateway (Gap 1/Gap
 * 2's explicit phase-23 release-gate obligation)." `docs/interface-
 * ledger.md`'s settled count (Gap 1): `tracker.*`, `observability.*`,
 * `evidence.get`/`evidence.attach` (one family), `result.submit`,
 * forwarded `run.status`/`run.cancel` (one family), `project.inspect`,
 * `contract.approve`, `capability.audit`/`capability.approve` (one
 * family) = 8.
 *
 * THIS IS A REAL FINDING, NOT A FIXTURE: the actual production `gateway
 * mcp` boot path (`packages/cli/src/cli-entry.ts`'s unexported
 * `defaultRunGatewayMcp`, invoked by `./bin.ts` whenever the installed
 * plugin's `.mcp.json` entry — `packages/cli/src/installer/mcp-json-
 * merge.ts`'s `{command: "engineering-orchestrator", args: ["gateway",
 * "mcp"]}`, golden-tested byte-for-byte — launches the gateway process)
 * currently boots a permanently-EMPTY `createToolRegistry()` with ZERO
 * families ever registered onto it. The fully-capable implementation
 * (`packages/gateway/src/mcp/server.ts`'s `buildGatewayMcpServer`, wired to
 * `packages/gateway/src/mcp/native-registry.ts`'s `buildNativeToolRegistry`
 * — the real 18-tool-name, 8-family assembly, built on the real MCP SDK
 * with a working `tools/call` dispatch) exists and is unit-tested in
 * `packages/gateway`'s own suite, but `packages/cli` has ZERO dependency
 * edge on `@eo/gateway` (confirmed both by this module's own
 * `checkGatewayDependencyEdge` and by `packages/cli/package.json` itself)
 * — it is never invoked from the shipped executable. Separately,
 * `packages/cli/src/gateway-mcp/stdio-server.ts`'s hand-rolled JSON-RPC
 * handler implements only `initialize`/`tools/list`; `tools/call` is
 * entirely unimplemented (`checkToolsCallSupported` below proves this
 * empirically, safely, with no real stdio/process involved) — so even a
 * fully-populated registry would not let a worker actually INVOKE a tool
 * through this code path today.
 *
 * This module's job, per this work item's own instruction, is to
 * ENUMERATE this gap accurately and report it — never to silently wire a
 * fix (explicitly out of scope for this task).
 */

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
  /** The identifier this check greps `cli-entry.ts`'s source for as evidence the family's builder is actually invoked at the production entrypoint. */
  readonly builderIdentifier: string;
  readonly wiredAtProductionEntrypoint: boolean;
  readonly ownerPhase: string;
}

/** The 8 families, their tool names (interface-ledger Gap 1's settled count), and the builder-function identifier that would have to appear in `cli-entry.ts` for that family to be genuinely wired at the production `gateway mcp` boot path. */
const FAMILY_SPECS: readonly Omit<FamilyWiringResult, "wiredAtProductionEntrypoint">[] = [
  {
    family: "tracker",
    toolNames: [
      "tracker.search",
      "tracker.get",
      "tracker.create",
      "tracker.update",
      "tracker.transition",
      "tracker.comment",
      "tracker.apply",
    ],
    builderIdentifier: "buildTrackerTools",
    ownerPhase: "16",
  },
  {
    family: "observability",
    toolNames: [
      "observability.query",
      "observability.get",
      "observability.plan_alert",
      "observability.plan_dashboard",
      "observability.plan_comment",
      "observability.apply",
    ],
    builderIdentifier: "buildObservabilityTools",
    ownerPhase: "16",
  },
  {
    family: "evidence",
    toolNames: ["evidence.get", "evidence.attach"],
    builderIdentifier: "buildEvidenceTools",
    ownerPhase: "16",
  },
  {
    family: "result",
    toolNames: ["result.submit"],
    builderIdentifier: "buildResultTools",
    ownerPhase: "16",
  },
  {
    family: "run-forward",
    toolNames: ["run.status", "run.cancel"],
    builderIdentifier: "buildRunForwardTools",
    ownerPhase: "16",
  },
  {
    family: "project-inspect",
    toolNames: ["project.inspect"],
    builderIdentifier: "registerIntakeTools",
    ownerPhase: "11",
  },
  {
    family: "contract-approve",
    toolNames: ["contract.approve"],
    builderIdentifier: "registerIntakeTools",
    ownerPhase: "11",
  },
  {
    family: "capability-audit-approve",
    toolNames: ["capability.audit", "capability.approve"],
    builderIdentifier: "registerCapabilityTools",
    ownerPhase: "12",
  },
];

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLI_ENTRY_PATH = join(
  HERE,
  "..",
  "..",
  "..",
  "packages",
  "cli",
  "src",
  "cli-entry.ts",
);
const DEFAULT_CLI_PACKAGE_JSON_PATH = join(
  HERE,
  "..",
  "..",
  "..",
  "packages",
  "cli",
  "package.json",
);

/**
 * Statically scans `cli-entry.ts`'s source text (read-only, deterministic —
 * mirrors `packages/contracts/src/gateway/server-name.test.ts`'s own
 * established literal-scan convention in this repo) for each family's
 * builder identifier. Injectable `cliEntrySourcePath` so tests can point
 * this at a fixture file rather than the real, shared source tree.
 */
export function checkFamilyWiringAtProductionEntrypoint(
  cliEntrySourcePath: string = DEFAULT_CLI_ENTRY_PATH,
): readonly FamilyWiringResult[] {
  const source = readFileSync(cliEntrySourcePath, "utf8");
  return FAMILY_SPECS.map((spec) => ({
    ...spec,
    wiredAtProductionEntrypoint: source.includes(spec.builderIdentifier),
  }));
}

/** Reads `packages/cli/package.json`'s own dependency graph and reports whether it declares `@eo/gateway` — corroborating evidence for the family-wiring gap above (no dependency edge, no possible import). */
export function checkGatewayDependencyEdge(
  cliPackageJsonPath: string = DEFAULT_CLI_PACKAGE_JSON_PATH,
): { readonly hasGatewayDependency: boolean } {
  const manifest = JSON.parse(readFileSync(cliPackageJsonPath, "utf8")) as {
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
  };
  const hasGatewayDependency =
    "@eo/gateway" in (manifest.dependencies ?? {}) ||
    "@eo/gateway" in (manifest.devDependencies ?? {});
  return { hasGatewayDependency };
}

export interface ToolsCallSupportResult {
  readonly supported: boolean;
  readonly evidence: string;
}

/**
 * Behavioral (not merely static) proof that `packages/cli/src/gateway-mcp/
 * stdio-server.ts`'s JSON-RPC handler has no `tools/call` support: boots a
 * REAL `startGatewayMcpServer` over `PassThrough` streams (exactly
 * `gateway-mcp.boot.test.ts`'s own established, hang-safe pattern — never
 * real `process.stdin`/`process.stdout`, so this can never block a test
 * run) with one fake tool registered, sends a real `tools/call` JSON-RPC
 * request over the wire, and asserts the response is the same
 * `JSON_RPC_METHOD_NOT_FOUND` shape any genuinely-unknown method gets.
 */
export interface RawJsonRpcResponse {
  readonly error?: { readonly code: number; readonly message: string };
  readonly result?: unknown;
}

/**
 * Pure interpretation of a `tools/call` JSON-RPC response — split out from
 * `checkToolsCallSupported`'s own real-stdio plumbing so both outcomes
 * (unimplemented today; a real result, if this gap is ever fixed) are
 * directly unit-testable without needing to fabricate a capable server.
 */
export function interpretToolsCallResponse(response: RawJsonRpcResponse): ToolsCallSupportResult {
  if (response.error !== undefined) {
    return {
      supported: false,
      evidence: `"tools/call" returned a JSON-RPC error: ${response.error.message} (code ${String(response.error.code)}) — the stdio server never implements tool invocation, only "initialize"/"tools/list"`,
    };
  }
  return {
    supported: true,
    evidence: `"tools/call" returned a real result: ${JSON.stringify(response.result)}`,
  };
}

export async function checkToolsCallSupported(): Promise<ToolsCallSupportResult> {
  const registry = createToolRegistry();
  registry.register({ name: "fake.tool", description: "a fake tool", inputSchema: {} });

  const input = new PassThrough();
  const output = new PassThrough();
  let handle: GatewayMcpServerHandle | undefined;
  try {
    handle = startGatewayMcpServer({ registry, input, output });

    const response = await new Promise<RawJsonRpcResponse>((resolve) => {
      let buffer = "";
      output.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex !== -1) {
          resolve(JSON.parse(buffer.slice(0, newlineIndex)) as RawJsonRpcResponse);
        }
      });
      input.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fake.tool", arguments: {} } })}\n`,
      );
    });

    return interpretToolsCallResponse(response);
  } finally {
    handle?.stop();
    input.end();
  }
}
