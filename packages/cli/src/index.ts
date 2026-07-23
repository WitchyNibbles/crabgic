/**
 * `engineering-orchestrator` (packages/cli) public barrel —
 * roadmap/09-cli-and-doctor.md. Every cross-cutting type/function this
 * package exposes for 10/11/12 to build their own command backends against
 * is exported from exactly this module; `./bin.ts` (the real executable
 * entry, not re-exported here) is the only file that touches a real
 * process/socket/stdio stream.
 */

// ---- Errors + exit codes ----
export * from "./errors.js";
export * from "./exit-codes.js";

// ---- argv: parser, secret-reference type, tokenizer ----
export * from "./argv/types.js";
export * from "./argv/parse-command.js";
export * from "./argv/secret-reference.js";
export * from "./argv/tokenize.js";

// ---- Typed UDS client (Interfaces produced item 2) ----
export * from "./uds-client/client.js";

// ---- gateway mcp: extensible tool registry + stdio boot (Gap 1/Gap 2) ----
export * from "./gateway-mcp/registry.js";
export * from "./gateway-mcp/protocol.js";
export * from "./gateway-mcp/stdio-server.js";

// ---- Approval-token minting primitive + terminal prompt (Interfaces produced item 6) ----
export * from "./approval/token.js";
export * from "./approval/prompt.js";

// ---- Doctor framework + every named check (Interfaces produced item 4) ----
export * from "./doctor/framework.js";
export * from "./doctor/process-probe.js";
export * from "./doctor/run-doctor.js";
export * from "./doctor/checks/engine-version.js";
export * from "./doctor/checks/sandbox-selftest.js";
export * from "./doctor/checks/hermeticity-selftest.js";
export * from "./doctor/checks/auth-probe.js";
export * from "./doctor/checks/git-plumbing.js";
export * from "./doctor/checks/xdg-permissions.js";
export * from "./doctor/checks/journal-chain.js";
export * from "./doctor/checks/wsl2-warnings.js";

// ---- evidence <change-set-id> query ----
export * from "./evidence/query.js";

// ---- Output conventions + status --watch renderer ----
export * from "./output/format.js";
export * from "./output/status-renderer.js";

// ---- Commands: dependency bag, NOT_IMPLEMENTED shape, dispatch, help ----
export * from "./commands/types.js";
export * from "./commands/not-implemented.js";
export * from "./commands/real-handlers.js";
export * from "./commands/dispatch.js";
export * from "./commands/help.js";

// ---- Project-hash derivation (provisional — see project-hash.ts's own doc comment) ----
export * from "./project-hash.js";

// ---- The testable core of bin.ts ----
export * from "./cli-entry.js";
export * from "./bootstrap.js";
