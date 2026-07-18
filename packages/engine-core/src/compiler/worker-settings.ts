import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import {
  WorkerSettingsJsonSchema,
  WorkerSdkOptionsSchema,
  type PermissionProfile,
  type SandboxProfile,
  type WorkerSettingsJson,
  type WorkerSdkOptions,
} from "./compiled-worker-profile.js";

/**
 * Serialization 1 of 2 (roadmap/03 §In scope: "one compiled decision, two
 * serializations"): the `--settings <file>` JSON shape, embedding the
 * already-compiled `permissions`/`sandbox` decision verbatim.
 */
export function toWorkerSettingsJson(
  permissions: PermissionProfile,
  sandbox: SandboxProfile,
): WorkerSettingsJson {
  return WorkerSettingsJsonSchema.parse({ permissions, sandbox });
}

/**
 * Serialization 2 of 2: the mirrored Agent SDK `query()` options subset.
 * `allowedTools`/`disallowedTools` are the SAME `permissions.allow`/
 * `permissions.deny` arrays projected into the SDK's own field names
 * (adaptation §5.3's worked example: `allowedTools: envelope.allowedTools`
 * — the compiled allow list, not a re-derivation) — "one compiled
 * decision, two serializations," not two independent decisions that could
 * drift from each other.
 *
 * `mcpServers` is keyed by `GATEWAY_MCP_SERVER_NAME` (interface-ledger Gap
 * 11 — imported, never hand-typed) with an EMPTY placeholder object value.
 * This pure compiler has no access to a live, wired SDK MCP server
 * instance (`createSdkMcpServer(...)`, adaptation §5.3) — registering the
 * actual gateway tool handlers is phase 16's job, and wiring that live
 * object into the SDK `query()` call is phase 06's job (out of scope
 * here, roadmap/03 §Out of scope: "Gateway MCP tool implementations and
 * the [GATEWAY_MCP_SERVER_NAME] tool registry itself — 16"). This compiler's own job
 * stops at the DECISION that exactly one server, under this one key, is
 * registered — `strictMcpConfig: true` (also emitted here) is what turns
 * that decision into "single-server exposure," per roadmap/03's own
 * footgun bullet: "single-server exposure via `strictMcpConfig` instead"
 * of ever denying `mcp__*` broadly. Recorded as a deviation-from-nothing
 * (no source material pins the placeholder's exact value) in
 * `../../README.md`.
 */
export function toWorkerSdkOptions(permissions: PermissionProfile): WorkerSdkOptions {
  return WorkerSdkOptionsSchema.parse({
    allowedTools: [...permissions.allow],
    disallowedTools: [...permissions.deny],
    permissionMode: "dontAsk",
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: { [GATEWAY_MCP_SERVER_NAME]: {} },
  });
}
