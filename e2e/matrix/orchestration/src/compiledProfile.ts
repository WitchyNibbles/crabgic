import type { CompiledWorkerProfile } from "@crabgic/engine-core";

/**
 * Own copy (not an import) of `packages/scheduler/src/test-support/minimal-
 * compiled-profile.ts` — that module's own doc comment marks it "not part
 * of this package's public barrel" (test-support-only), and this project's
 * own build constraint confines it to `e2e/matrix/orchestration/` with no
 * `packages/*` source edits, so a genuinely shared helper cannot be
 * imported across the package boundary. Kept byte-identical in shape to
 * the original (which itself mirrors `packages/supervisor/src/worker-
 * lifecycle/test-support/minimal-compiled-profile.ts`) so every scenario in
 * `../test/` spawns the fake engine against the exact same minimal,
 * schema-valid `CompiledWorkerProfile` the scheduler's own e2e suite uses —
 * this harness cares about dispatch/park/crash/recovery ARCS, never about
 * permission/sandbox policy content itself (that is 03/06's own territory).
 */
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
      // Enabling the sandbox auto-allows Bash unless this is explicitly
      // false, which silently voids the compiled Bash allowlist — see
      // `packages/engine-core/src/compiler/sandbox-profile.ts`.
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [], allowAllUnixSockets: true, allowLocalBinding: false },
      filesystem: { allowWrite: [], denyWrite: [], denyRead: [] },
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
        autoAllowBashIfSandboxed: false,
        allowUnsandboxedCommands: false,
        network: { allowedDomains: [], allowAllUnixSockets: true, allowLocalBinding: false },
        filesystem: { allowWrite: [], denyWrite: [], denyRead: [] },
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

/**
 * Always-allow adjudication stub — this harness never exercises adjudication
 * POLICY itself (03/06's territory), only the dispatch/park/crash/recovery
 * arcs on top of it. Deliberately NOT annotated `: AdjudicationCallback`
 * (matching the original `packages/scheduler` copy this mirrors) — a plain
 * inferred 2-parameter async function is still structurally assignable
 * everywhere an `AdjudicationCallback` (3-parameter) is expected (TypeScript
 * allows a function with FEWER declared parameters to satisfy a call-shape
 * requiring more), while staying directly callable with just
 * `(toolName, toolInput)` from this project's own unit tests, and keeping
 * its return type narrowed to the "allow" branch only.
 */
export async function allowAllAdjudicate(
  _toolName: string,
  toolInput: Readonly<Record<string, unknown>>,
): Promise<{
  readonly behavior: "allow";
  readonly updatedInput: Readonly<Record<string, unknown>>;
}> {
  return { behavior: "allow", updatedInput: toolInput };
}
