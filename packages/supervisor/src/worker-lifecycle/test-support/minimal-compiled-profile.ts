/**
 * Test-support-only helper (not part of this package's public barrel): a
 * minimal, schema-valid `CompiledWorkerProfile` for tests that spawn
 * against the fake engine and don't care about permission/sandbox content
 * — `@eo/engine-core` exports the schema/type but no fixture builder of
 * its own (that lives in `@eo/testkit`'s fixture registry for contracts,
 * not for this compiler-owned shape), so this package builds its own
 * literal instance, matching `CompiledWorkerProfileSchema` exactly.
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
