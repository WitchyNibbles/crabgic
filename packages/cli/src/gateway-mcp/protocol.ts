/**
 * Minimal JSON-RPC 2.0 message shapes for the MCP stdio transport — a
 * single JSON object per ndjson line (no length-prefix framing), matching
 * both this repo's own supervisor wire-protocol convention
 * (`@eo/supervisor`'s `protocol/wire-schema.ts`) and the published MCP
 * stdio-transport spec. This phase implements only what `tools/list`
 * requires (roadmap/09 work item 2); a real tool *call* dispatch
 * (`tools/call`) is explicitly out of scope here — the registered families'
 * own handlers land in later phases (16/11/12).
 */
import { z } from "zod";

export const JsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number()]),
    method: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;

export function buildResult(id: string | number, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function buildError(id: string | number, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function encodeLine(message: JsonRpcResponse): string {
  return `${JSON.stringify(message)}\n`;
}
