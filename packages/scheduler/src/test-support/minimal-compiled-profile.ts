/**
 * Test-support-only helper (not part of this package's public barrel) —
 * mirrors `packages/supervisor/src/worker-lifecycle/test-support/minimal-
 * compiled-profile.ts` byte-for-byte in shape: a minimal, schema-valid
 * `CompiledWorkerProfile` for tests that spawn against the fake engine and
 * don't care about permission/sandbox content, plus an always-allow
 * adjudication stub.
 */
import type { CompiledWorkerProfile } from "@eo/engine-core";

export function buildMinimalCompiledProfile(): CompiledWorkerProfile {
  return {
    permissions: {
      defaultMode: "dontAsk",
      disableBypassPermissionsMode: "disable",
      allow: [],
      deny: [],
      ask: [],
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [], allowAllUnixSockets: true, allowLocalBinding: false },
      filesystem: { allowWrite: [], denyRead: [] },
      credentials: { envVars: [] },
    },
    settingsJson: {
      permissions: {
        defaultMode: "dontAsk",
        disableBypassPermissionsMode: "disable",
        allow: [],
        deny: [],
        ask: [],
      },
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        allowUnsandboxedCommands: false,
        network: { allowedDomains: [], allowAllUnixSockets: true, allowLocalBinding: false },
        filesystem: { allowWrite: [], denyRead: [] },
        credentials: { envVars: [] },
      },
    },
    sdkOptions: {
      allowedTools: [],
      disallowedTools: [],
      permissionMode: "dontAsk",
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: {},
    },
  };
}

/** Always-allow adjudication stub for tests that don't exercise adjudication policy itself. */
export async function allowAllAdjudicate(
  _toolName: string,
  toolInput: Readonly<Record<string, unknown>>,
): Promise<{
  readonly behavior: "allow";
  readonly updatedInput: Readonly<Record<string, unknown>>;
}> {
  return { behavior: "allow", updatedInput: toolInput };
}
