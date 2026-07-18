import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import type { CompiledWorkerProfile } from "@eo/engine-core";
import { evaluateAllLayers } from "./layered-conformance.js";
import {
  alwaysAllowAdjudicate,
  alwaysDenyAdjudicate,
  alwaysThrowAdjudicate,
} from "./adjudication-layer.js";

/**
 * `evaluateAllLayers` — combined layer-2/3/4 verdict (roadmap/03 work item
 * 6). Each sub-layer is unit-tested in its own module; this suite proves
 * the AND-combination and the "independently assertable" per-field shape.
 */
function buildProfile(
  overrides: Partial<CompiledWorkerProfile["permissions"]> = {},
): CompiledWorkerProfile {
  const permissions = {
    defaultMode: "dontAsk" as const,
    disableBypassPermissionsMode: "disable" as const,
    allow: ["Bash(echo:*)"],
    deny: [],
    ask: [],
    ...overrides,
  };
  const sandbox = {
    enabled: true as const,
    failIfUnavailable: true as const,
    allowUnsandboxedCommands: false as const,
    network: {
      allowedDomains: [],
      allowAllUnixSockets: true as const,
      allowLocalBinding: false as const,
    },
    filesystem: { allowWrite: ["<worktree>"], denyRead: ["~/.ssh/**"] },
    credentials: { envVars: [] },
  };
  return {
    permissions,
    sandbox,
    settingsJson: { permissions, sandbox },
    sdkOptions: {
      allowedTools: [...permissions.allow],
      disallowedTools: [...permissions.deny],
      permissionMode: "dontAsk",
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: { [GATEWAY_MCP_SERVER_NAME]: {} },
    },
  };
}

describe("evaluateAllLayers", () => {
  it("allow + allow + allow -> overall allow, every field populated", async () => {
    const profile = buildProfile();
    const verdict = await evaluateAllLayers(
      profile,
      { toolName: "Bash", toolInput: { command: "echo hi" } },
      alwaysAllowAdjudicate,
    );
    expect(verdict).toEqual({
      permissions: "allow",
      adjudication: "allow",
      sandbox: "allow",
      overall: "allow",
    });
  });

  it("permission layer alone denying makes overall deny even if adjudication/sandbox allow", async () => {
    const profile = buildProfile({ allow: [] });
    const verdict = await evaluateAllLayers(
      profile,
      { toolName: "Bash", toolInput: { command: "echo hi" } },
      alwaysAllowAdjudicate,
    );
    expect(verdict.permissions).toBe("deny");
    expect(verdict.overall).toBe("deny");
  });

  it("adjudication layer alone denying makes overall deny even if permissions/sandbox allow", async () => {
    const profile = buildProfile();
    const verdict = await evaluateAllLayers(
      profile,
      { toolName: "Bash", toolInput: { command: "echo hi" } },
      alwaysDenyAdjudicate,
    );
    expect(verdict.permissions).toBe("allow");
    expect(verdict.sandbox).toBe("allow");
    expect(verdict.adjudication).toBe("deny");
    expect(verdict.overall).toBe("deny");
  });

  it("a throwing adjudication callback still fails closed inside the combined evaluation", async () => {
    const profile = buildProfile();
    const verdict = await evaluateAllLayers(
      profile,
      { toolName: "Bash", toolInput: { command: "echo hi" } },
      alwaysThrowAdjudicate,
    );
    expect(verdict.adjudication).toBe("deny");
    expect(verdict.overall).toBe("deny");
  });

  it("sandbox layer alone denying (disallowed network domain) makes overall deny", async () => {
    const profile = buildProfile({ allow: ["Bash(curl:*)"] });
    const verdict = await evaluateAllLayers(
      profile,
      { toolName: "Bash", toolInput: { command: "curl http://example.com" } },
      alwaysAllowAdjudicate,
    );
    expect(verdict.permissions).toBe("allow");
    expect(verdict.sandbox).toBe("deny");
    expect(verdict.overall).toBe("deny");
  });

  it("an explicit permissionRules override is used instead of the profile's own permissions (cross-level merge support)", async () => {
    const profile = buildProfile({ allow: [] });
    const verdict = await evaluateAllLayers(
      profile,
      { toolName: "Bash", toolInput: { command: "echo hi" } },
      alwaysAllowAdjudicate,
      { allow: ["Bash(echo:*)"], deny: [] },
    );
    expect(verdict.permissions).toBe("allow");
    expect(verdict.overall).toBe("allow");
  });
});
