import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { evaluateSandboxLayer, extractNetworkDomain } from "./sandbox-evaluator.js";
import type { SandboxProfile } from "@eo/engine-core";

/**
 * Layer 4 (sandbox) — roadmap/03-envelope-compiler-engine-adapter.md §In
 * scope "Fake engine" bullet; docs/engine-baseline.md §6. Scoped narrowly
 * (see `../../README.md`'s "sandbox-layer scope" deviation note): network
 * egress via `network.allowedDomains`, and `filesystem.denyRead`
 * containment — NOT `filesystem.allowWrite`, which the compiled profile
 * only ever populates with worktree/tmp placeholder tokens
 * (`@eo/engine-core`'s own documented seam decision), un-testable without
 * phase 06/07's spawn-time path substitution.
 */
function buildSandboxProfile(overrides: Partial<SandboxProfile> = {}): SandboxProfile {
  return {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    network: { allowedDomains: [], allowAllUnixSockets: true, allowLocalBinding: false },
    filesystem: {
      allowWrite: ["<worktree>", "<worker-tmp>"],
      denyRead: ["~/.ssh/**", "~/.aws/**"],
    },
    credentials: { envVars: [] },
    ...overrides,
  };
}

describe("extractNetworkDomain", () => {
  it("extracts a domain from a full URL", () => {
    expect(extractNetworkDomain("curl http://example.com/path")).toBe("example.com");
  });

  it("extracts a domain from a bare curl target", () => {
    expect(extractNetworkDomain("curl api.example.com")).toBe("api.example.com");
  });

  it("returns undefined for a command with no network reference", () => {
    expect(extractNetworkDomain("echo hello")).toBeUndefined();
  });
});

describe("evaluateSandboxLayer — network egress (docs/engine-baseline.md §6 'egress denied, empty allowlist')", () => {
  it("denies a Bash call targeting a domain outside allowedDomains", () => {
    const sandbox = buildSandboxProfile();
    const verdict = evaluateSandboxLayer(sandbox, {
      toolName: "Bash",
      toolInput: { command: "curl http://example.com" },
    });
    expect(verdict).toBe("deny");
  });

  it("allows a Bash call targeting an explicitly allowlisted domain", () => {
    const sandbox = buildSandboxProfile({
      network: {
        allowedDomains: ["api.example.com"],
        allowAllUnixSockets: true,
        allowLocalBinding: false,
      },
    });
    const verdict = evaluateSandboxLayer(sandbox, {
      toolName: "Bash",
      toolInput: { command: "curl http://api.example.com" },
    });
    expect(verdict).toBe("allow");
  });

  it("allows a Bash call with no network reference regardless of allowedDomains", () => {
    const sandbox = buildSandboxProfile();
    const verdict = evaluateSandboxLayer(sandbox, {
      toolName: "Bash",
      toolInput: { command: "echo hi" },
    });
    expect(verdict).toBe("allow");
  });
});

describe("evaluateSandboxLayer — filesystem denyRead (docs/engine-baseline.md §6 'denyRead ~/.ssh enforced')", () => {
  it("denies a Read under a denyRead entry", () => {
    const sandbox = buildSandboxProfile();
    const verdict = evaluateSandboxLayer(sandbox, {
      toolName: "Read",
      toolInput: { file_path: "~/.ssh/id_rsa" },
    });
    expect(verdict).toBe("deny");
  });

  it("allows a Read outside any denyRead entry", () => {
    const sandbox = buildSandboxProfile();
    const verdict = evaluateSandboxLayer(sandbox, {
      toolName: "Read",
      toolInput: { file_path: "packages/example/src/foo.ts" },
    });
    expect(verdict).toBe("allow");
  });

  it("allows a non-filesystem, non-Bash tool call by default (e.g. mcp__ tool)", () => {
    const sandbox = buildSandboxProfile();
    expect(
      evaluateSandboxLayer(sandbox, {
        toolName: `mcp__${GATEWAY_MCP_SERVER_NAME}__search`,
        toolInput: {},
      }),
    ).toBe("allow");
  });
});
