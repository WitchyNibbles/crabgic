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
 * denyRead}`, `credentials.envVars` — plus two fields added by the phase-06
 * sandbox-containment security-fix round (`autoAllowBashIfSandboxed` and
 * `filesystem.denyWrite`), each documented at its own declaration below.
 * Adaptation §4.2's own illustrative
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
    // `boolean`, not `z.literal(true)` (widened 2026-07-28, ledger Gap 18
    // part 5). Pinning it to `true` made an ambient grant unrepresentable as
    // anything else: `allowedNetworkDestinations: []` did not mean "no
    // network", because a reachable docker socket is host-root write and
    // `SSH_AUTH_SOCK` is not covered by the `~/.ssh` read deny. Under a
    // standing approval that grant has to be declarable — and therefore
    // deniable — so the type has to admit `false`.
    allowAllUnixSockets: z.boolean(),
    allowLocalBinding: z.literal(false),
  })
  .strict();

/**
 * `denyWrite` (phase-06 sandbox-containment security-fix round) is REQUIRED,
 * not optional. The SDK documents it as "Additional paths to deny writing
 * within the sandbox. Merged with paths from `Edit(...)` deny permission
 * rules" (`@anthropic-ai/claude-agent-sdk` `sdk.d.ts`, `SandboxSettings.
 * filesystem.denyWrite`) — the write-side sibling of `denyRead`. It exists
 * here because `allowWrite` deliberately grants the WHOLE worktree (see
 * `sandbox-profile.ts`'s own justification for why narrowing it to owned
 * paths is not safe), which would otherwise hand a sandboxed shell command
 * write access to the worktree's own git internals — and `.git/hooks/*` /
 * `.git/config` are HOST code execution the next time the supervisor runs
 * git, i.e. code that escapes the sandbox entirely.
 */
export const SandboxFilesystemProfileSchema = z
  .object({
    allowWrite: z.array(z.string()),
    denyWrite: z.array(z.string()),
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
    /**
     * `z.literal(false)`, REQUIRED — never optional, never absent. The SDK's
     * `SandboxSettings.autoAllowBashIfSandboxed` DEFAULTS TO TRUE (its own
     * typings say so verbatim: "sandbox.autoAllowBashIfSandboxed is
     * independent and still defaults to true, so set it to false to keep
     * prompting for sandboxed commands"), so omitting the key is not a
     * neutral choice — it silently auto-allows the `Bash` tool and voids
     * `permission-profile.ts`'s four-literal `MANDATORY_BASH_ALLOWLIST`
     * outright. Proven live, not inferred: see
     * `docs/evidence/phase-06/sandbox-containment-determination.json`'s
     * `compiled-bash-allowlist-sandboxed` / `-unsandboxed` arm pair — the
     * SAME compiled permission object denied un-allowlisted `printf > file`
     * commands with the sandbox off and PERMITTED them with it on. Modelled
     * as a required literal (exactly like `allowUnsandboxedCommands`) so a
     * hand-built or future profile cannot regress to the unsafe default by
     * simply forgetting the field.
     */
    autoAllowBashIfSandboxed: z.literal(false),
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
