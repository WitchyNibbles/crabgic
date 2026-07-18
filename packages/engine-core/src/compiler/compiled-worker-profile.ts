import { z } from "zod";

/**
 * `PermissionProfile` — `compileEnvelope`'s permission-rule decision
 * (roadmap/03-envelope-compiler-engine-adapter.md §In scope, "Envelope
 * compiler" bullet; adaptation §4.1, §5.1). `ask` is always emitted empty
 * — adaptation §4.1: "the envelope compiler is a small, testable function:
 * `AuthorizationEnvelope -> {permissions: {allow: [...], deny: [...], ask:
 * []}, permissionMode: 'dontAsk'}`."
 */
export const PermissionProfileSchema = z
  .object({
    defaultMode: z.literal("dontAsk"),
    disableBypassPermissionsMode: z.literal("disable"),
    allow: z.array(z.string()),
    deny: z.array(z.string()),
    ask: z.array(z.string()),
  })
  .strict();
export type PermissionProfile = z.infer<typeof PermissionProfileSchema>;

/**
 * `SandboxProfile` — `compileEnvelope`'s sandbox decision (adaptation
 * §4.2, §5.1; docs/engine-baseline.md §6). Deliberately scoped to exactly
 * the fields this worker's brief enumerates: `enabled`,
 * `failIfUnavailable`, `allowUnsandboxedCommands`, `network.{allowedDomains,
 * allowAllUnixSockets, allowLocalBinding}`, `filesystem.{allowWrite,
 * denyRead}`, `credentials.envVars`. Adaptation §4.2's own illustrative
 * sketch additionally shows `credentials.files` (deny-listing `~/.ssh`,
 * `~/.aws/credentials` file paths directly) and `excludedCommands` —
 * omitted here because they are not named by this phase's binding work
 * item text and are redundant with this profile's own
 * `filesystem.denyRead` + the permission profile's `Read(~/.ssh/**)`/
 * `Read(~/.aws/**)` denies (see `../footguns/invariants.ts` for the
 * cross-checked invariant). See `../../README.md` for this deviation
 * recorded in full.
 *
 * `allowAllUnixSockets: true` (boolean) is the Linux/WSL2 UDS gate
 * (docs/engine-baseline.md §6, "Schema correction: Unix-socket allow
 * flag" — confirmed empirically: default config -> UDS unreachable;
 * `network.allowAllUnixSockets: true` -> UDS reachable).
 * `network.allowUnixSockets` is a DIFFERENT, `string[]`-typed,
 * macOS-only path allowlist ("ignored on Linux (seccomp cannot filter by
 * path)" per the SDK's own docstring, baseline §6) — this schema
 * deliberately has no `allowUnixSockets` field at all, so it can never be
 * accidentally emitted in its place.
 */
export const SandboxNetworkProfileSchema = z
  .object({
    allowedDomains: z.array(z.string()),
    allowAllUnixSockets: z.literal(true),
    allowLocalBinding: z.literal(false),
  })
  .strict();

export const SandboxFilesystemProfileSchema = z
  .object({
    allowWrite: z.array(z.string()),
    denyRead: z.array(z.string()),
  })
  .strict();

export const SandboxCredentialEnvVarSchema = z
  .object({
    name: z.string(),
    mode: z.literal("mask"),
  })
  .strict();

export const SandboxCredentialsProfileSchema = z
  .object({
    envVars: z.array(SandboxCredentialEnvVarSchema),
  })
  .strict();

export const SandboxProfileSchema = z
  .object({
    enabled: z.literal(true),
    failIfUnavailable: z.literal(true),
    allowUnsandboxedCommands: z.literal(false),
    network: SandboxNetworkProfileSchema,
    filesystem: SandboxFilesystemProfileSchema,
    credentials: SandboxCredentialsProfileSchema,
  })
  .strict();
export type SandboxProfile = z.infer<typeof SandboxProfileSchema>;

/**
 * `WorkerSettingsJson` — the `--settings <file>` shape (roadmap/03 §In
 * scope: "`WorkerSettingsJson` (the `--settings <file>` shape) and
 * mirrored `WorkerSdkOptions` … one compiled decision, two
 * serializations"). Literally embeds the same `PermissionProfile`/
 * `SandboxProfile` values `WorkerSdkOptions` derives its own fields from —
 * see `worker-settings.ts`.
 */
export const WorkerSettingsJsonSchema = z
  .object({
    permissions: PermissionProfileSchema,
    sandbox: SandboxProfileSchema,
  })
  .strict();
export type WorkerSettingsJson = z.infer<typeof WorkerSettingsJsonSchema>;

/**
 * `WorkerSdkOptions` — the Agent SDK `query()` options subset (roadmap/03
 * §In scope: "`allowedTools`/`disallowedTools`, `permissionMode`,
 * `settingSources: []`, `strictMcpConfig: true`, `mcpServers` keyed
 * `GATEWAY_MCP_SERVER_NAME`"). `settingSources` is a `z.tuple([])` — the
 * exact empty-array type, not merely `z.array(z.never())` — so
 * `settingSources: []` is visible EXPLICITLY in the golden artifacts
 * (roadmap/03 §Risks, "§10 risk #3": "`WorkerSdkOptions` must show
 * `settingSources: []` explicitly in the golden artifacts so drift is
 * visible before 06 ever spawns a real worker").
 *
 * `mcpServers`' value type is `z.record(z.string(), z.unknown())` — see
 * `worker-settings.ts`'s doc comment for why this compiler emits an empty
 * placeholder object under the `GATEWAY_MCP_SERVER_NAME` key rather than a
 * live SDK MCP server instance.
 */
export const WorkerSdkOptionsSchema = z
  .object({
    allowedTools: z.array(z.string()),
    disallowedTools: z.array(z.string()),
    permissionMode: z.literal("dontAsk"),
    settingSources: z.tuple([]),
    strictMcpConfig: z.literal(true),
    mcpServers: z.record(z.string(), z.unknown()),
  })
  .strict();
export type WorkerSdkOptions = z.infer<typeof WorkerSdkOptionsSchema>;

/**
 * `CompiledWorkerProfile` — `compileEnvelope`'s full return shape
 * (roadmap/03 §In scope work item 2/3). `permissions`/`sandbox` are the
 * "one compiled decision"; `settingsJson`/`sdkOptions` are its "two
 * serializations" (roadmap/03 §In scope, "Envelope compiler" bullet).
 */
export const CompiledWorkerProfileSchema = z
  .object({
    permissions: PermissionProfileSchema,
    sandbox: SandboxProfileSchema,
    settingsJson: WorkerSettingsJsonSchema,
    sdkOptions: WorkerSdkOptionsSchema,
  })
  .strict();
export type CompiledWorkerProfile = z.infer<typeof CompiledWorkerProfileSchema>;
