/**
 * `GATEWAY_MCP_SERVER_NAME` — the single literal every engine-side MCP
 * registration derives from (roadmap/02-contracts-and-schemas.md §In
 * scope, "`GATEWAY_MCP_SERVER_NAME` constant" bullet: `"eo_gateway"` — the
 * single literal every engine-side MCP registration derives from; no phase
 * hand-types the literal a second time. Interface-ledger Gap 11 ruling:
 * the server name is pinned as this single named constant, exported from
 * `packages/contracts` (this phase) — not independently hand-typed as a
 * literal string in each consuming phase.
 *
 * Every consumer imports this constant instead of hand-typing the string:
 *  - 03's compiler derives the mandatory `mcp__${GATEWAY_MCP_SERVER_NAME}__*`
 *    permission-allow entry from it.
 *  - 06's `mcpServers` key and `strictMcpConfig` allowlist reference it.
 *  - 10's `.mcp.json` entry key is golden-tested against it.
 *  - 16 registers its SDK MCP server under it and derives the
 *    `mcp__${GATEWAY_MCP_SERVER_NAME}__<tool>` wire-prefix from it.
 *  - 11/12 import it to register their own tool families into the same
 *    shared registry (interface-ledger Gap 1).
 *
 * This phase enforces itself as the sole definition site with a
 * repo-wide, read-only scan (see `server-name.test.ts`'s sole-definition-
 * site test) — the wire prefix is always derived at the call site, never
 * hand-typed a second time anywhere under `packages/*` (src).
 */
export const GATEWAY_MCP_SERVER_NAME = "eo_gateway" as const;
