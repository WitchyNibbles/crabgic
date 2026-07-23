/**
 * `gateway mcp`'s stdio boot — roadmap/09-cli-and-doctor.md §In scope:
 * "boots the gateway MCP server (stdio) over `packages/gateway`'s
 * (16) extensible tool registry, addressed by the `GATEWAY_MCP_SERVER_NAME`
 * constant (02)." Exit criterion: "starts and lists exactly the resolved
 * tool set over stdio to a stub MCP client." `input`/`output` are
 * injectable (default `process.stdin`/`process.stdout`) so the boot test
 * never needs a real child process — a `stream.PassThrough` pair stands in
 * for stdio.
 *
 * ADVERSARIAL-REVIEW FIX (2026-07-24): line buffering used to be a bare
 * `buffer += chunk`, flushed only on `\n`, with no size cap — a newline-less
 * oversized frame grew this buffer without bound (an OOM DoS from a
 * misbehaving/compromised MCP peer over stdio). This now reuses
 * `@eo/supervisor`'s own `createLineFramer`/`LineTooLongError` — the exact
 * same `MAX_LINE_BYTES`-capped framer the UDS client/server already use —
 * rather than a second, uncapped implementation.
 */
import { Readable, Writable } from "node:stream";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { createLineFramer, LineTooLongError } from "@eo/supervisor";
import {
  buildError,
  buildResult,
  encodeLine,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  JsonRpcRequestSchema,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol.js";
import type { McpToolRegistry } from "./registry.js";

export const GATEWAY_MCP_SERVER_VERSION = "0.0.0";

export interface GatewayMcpServerOptions {
  readonly registry: McpToolRegistry;
  readonly input?: Readable;
  readonly output?: Writable;
}

export interface GatewayMcpServerHandle {
  /** Resolves once the input stream ends (EOF) — the real stdio boot only ends when the parent (Claude Code) closes the pipe. */
  readonly closed: Promise<void>;
  stop(): void;
}

function handleRequest(request: JsonRpcRequest, registry: McpToolRegistry): JsonRpcResponse {
  if (request.method === "initialize") {
    return buildResult(request.id, {
      protocolVersion: "2024-11-05",
      serverInfo: { name: GATEWAY_MCP_SERVER_NAME, version: GATEWAY_MCP_SERVER_VERSION },
      capabilities: { tools: {} },
    });
  }
  if (request.method === "tools/list") {
    return buildResult(request.id, { tools: registry.list() });
  }
  return buildError(request.id, JSON_RPC_METHOD_NOT_FOUND, `unknown method "${request.method}"`);
}

/**
 * Boots the MCP stdio server: reads ndjson JSON-RPC request lines from
 * `input`, writes exactly one response line per request to `output`. Never
 * throws for a malformed line (a parse-error response is written instead,
 * per JSON-RPC convention) — one bad line never crashes the whole
 * long-running process.
 */
export function startGatewayMcpServer(options: GatewayMcpServerOptions): GatewayMcpServerHandle {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const framer = createLineFramer();
  let stopped = false;

  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  function onData(chunk: Buffer | string): void {
    if (stopped) return;
    let lines: readonly string[];
    try {
      lines = framer.push(chunk);
    } catch (err) {
      if (err instanceof LineTooLongError) {
        // A misbehaving/compromised peer sending an unbounded, newline-less
        // frame — reject and stop serving rather than buffer without limit.
        output.write(
          encodeLine(buildError(0, JSON_RPC_INVALID_REQUEST, `oversized line rejected: ${err.message}`)),
        );
        stopped = true;
        input.off("data", onData);
        resolveClosed();
        return;
      }
      throw err;
    }
    for (const line of lines) {
      if (line.trim().length > 0) {
        processLine(line);
      }
    }
  }

  function processLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      output.write(encodeLine(buildError(0, JSON_RPC_PARSE_ERROR, "malformed JSON-RPC line")));
      return;
    }
    const result = JsonRpcRequestSchema.safeParse(parsed);
    if (!result.success) {
      const id = typeof (parsed as { id?: unknown })?.id === "string" ||
        typeof (parsed as { id?: unknown })?.id === "number"
        ? (parsed as { id: string | number }).id
        : 0;
      output.write(encodeLine(buildError(id, JSON_RPC_PARSE_ERROR, "invalid JSON-RPC request shape")));
      return;
    }
    const response = handleRequest(result.data, options.registry);
    output.write(encodeLine(response));
  }

  input.on("data", onData);
  input.on("end", () => {
    stopped = true;
    resolveClosed();
  });

  return {
    closed,
    stop() {
      stopped = true;
      input.off("data", onData);
      resolveClosed();
    },
  };
}
