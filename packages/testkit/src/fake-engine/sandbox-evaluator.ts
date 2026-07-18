import type { SandboxProfile } from "@eo/engine-core";
import { matchesAnchoredGlobLiteral } from "./path-matching.js";
import type { FakeToolCall } from "./tool-call.js";

/**
 * Layer 4 (sandbox) — roadmap/03-envelope-compiler-engine-adapter.md §In
 * scope "Fake engine" bullet; docs/engine-baseline.md §6. Scoped
 * deliberately narrowly (see `../../README.md`'s "sandbox-layer scope"
 * deviation note): network egress via `network.allowedDomains`, and
 * `filesystem.denyRead` containment — NOT `filesystem.allowWrite`, which
 * the compiled profile only ever populates with worktree/tmp placeholder
 * tokens (`@eo/engine-core`'s own documented seam decision, un-testable
 * without phase 06/07's spawn-time path substitution).
 */
const URL_PATTERN = /https?:\/\/([^/\s"']+)/i;
const BARE_NETWORK_COMMAND_PATTERN = /\b(?:curl|wget)\s+([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;

export function extractNetworkDomain(command: string): string | undefined {
  const urlMatch = URL_PATTERN.exec(command);
  const urlHost = urlMatch?.[1];
  if (urlHost !== undefined) {
    return urlHost.split(":")[0];
  }
  return BARE_NETWORK_COMMAND_PATTERN.exec(command)?.[1];
}

export function evaluateSandboxLayer(
  sandbox: SandboxProfile,
  call: FakeToolCall,
): "allow" | "deny" {
  if (call.toolName === "Bash") {
    const command = typeof call.toolInput.command === "string" ? call.toolInput.command : "";
    const domain = extractNetworkDomain(command);
    if (domain !== undefined && !sandbox.network.allowedDomains.includes(domain)) {
      return "deny";
    }
    return "allow";
  }

  if (call.toolName === "Edit" || call.toolName === "Write" || call.toolName === "Read") {
    const path = typeof call.toolInput.file_path === "string" ? call.toolInput.file_path : "";
    const denied = sandbox.filesystem.denyRead.some((entry) =>
      matchesAnchoredGlobLiteral(entry, path),
    );
    return denied ? "deny" : "allow";
  }

  return "allow";
}
