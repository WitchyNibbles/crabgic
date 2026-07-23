import { isAbsolute } from "node:path";
import type { Options, SandboxSettings } from "@anthropic-ai/claude-agent-sdk";
import {
  assertNoFootguns,
  WORKER_TMP_WRITE_PLACEHOLDER,
  WORKTREE_WRITE_PLACEHOLDER,
  type CompiledWorkerProfile,
} from "@eo/engine-core";
import { buildGatewayMcpServers } from "./gateway-server-config.js";
import { resolveWorkerModel } from "./model-routing.js";

/**
 * `options-assembler` — roadmap/06-claude-engine-adapter.md §In scope,
 * "Spawn path" (work item 1); README design decisions 5, 6, 9. Pure: reads
 * only its own inputs, never `fs`/`process.env` — the composition root
 * (the adapter, W4's `adapter.ts`) is responsible for resolving paths,
 * reading provisioning results, and injecting auth BEFORE calling into
 * this module.
 */

// ---------------------------------------------------------------------------
// substituteWorktreePlaceholders
// ---------------------------------------------------------------------------

/**
 * Thrown by `substituteWorktreePlaceholders` when `worktreePath`/`workerTmp`
 * fail the absolute-path/no-traversal/no-glob-metacharacter validation
 * ("Validate at system boundaries; fail fast" — coding-style ground rule).
 */
export class PlaceholderSubstitutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaceholderSubstitutionError";
  }
}

const GLOB_METACHARACTER_PATTERN = /[*?[\]{}\\]/;

/** Minimum number of non-empty path segments a substituted worktree/worker-tmp path must carry — rejects filesystem-root `/` and single-segment `/x` (Finding 4: root-write defense). */
const MINIMUM_PATH_DEPTH = 2;

function assertSafeAbsolutePath(label: string, value: string): void {
  if (!isAbsolute(value)) {
    throw new PlaceholderSubstitutionError(
      `${label} must be an absolute path: ${JSON.stringify(value)}`,
    );
  }
  if (value.split("/").some((segment) => segment === "..")) {
    throw new PlaceholderSubstitutionError(
      `${label} must not contain a '..' path segment: ${JSON.stringify(value)}`,
    );
  }
  if (value.includes("~")) {
    throw new PlaceholderSubstitutionError(
      `${label} must not contain '~' (home-anchoring is not resolved here): ${JSON.stringify(value)}`,
    );
  }
  // Finding 4: reject `<`/`>` — this rejects the literal placeholder tokens
  // (`<worktree>`/`<worker-tmp>`, which both contain angle brackets) so an
  // injected token can never re-enter the profile as a substitution VALUE and
  // be expanded by a later pass (scope corruption), and rejects any other
  // angle-bracket metacharacter outright.
  if (value.includes("<") || value.includes(">")) {
    throw new PlaceholderSubstitutionError(
      `${label} must not contain '<' or '>' (angle brackets / placeholder-token metacharacters): ${JSON.stringify(value)}`,
    );
  }
  if (GLOB_METACHARACTER_PATTERN.test(value)) {
    throw new PlaceholderSubstitutionError(
      `${label} must not contain glob metacharacters: ${JSON.stringify(value)}`,
    );
  }
  // Finding 4: enforce a minimum depth so filesystem-root `/` and a
  // single-segment `/x` are rejected (a `<worktree>` substituted to `/`
  // would anchor owned-path write rules at the filesystem root).
  const segments = value.split("/").filter((segment) => segment.length > 0);
  if (segments.length < MINIMUM_PATH_DEPTH) {
    throw new PlaceholderSubstitutionError(
      `${label} must have at least ${String(MINIMUM_PATH_DEPTH)} non-empty path segments ` +
        `(refusing a root-level / near-root path): ${JSON.stringify(value)}`,
    );
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * SINGLE simultaneous substitution pass (Finding 4): both placeholder tokens
 * are replaced in ONE regex scan via an alternation, so a replacement value
 * that itself happened to contain a token could never be re-scanned and
 * expanded by a "later pass" (the two sequential `String#replace`es this
 * previously used could). `String#replace` never re-processes text it just
 * inserted, so the map lookup per match is a closed, order-independent
 * substitution. The tokens (`<worktree>`/`<worker-tmp>`) contain no
 * regex-special characters, but they are escaped defensively regardless.
 */
function buildSinglePassSubstituter(
  replacements: ReadonlyArray<readonly [string, string]>,
): (text: string) => string {
  const replacementByToken = new Map(replacements);
  const pattern = new RegExp(replacements.map(([token]) => escapeRegExp(token)).join("|"), "g");
  return (text: string): string =>
    text.replace(pattern, (token) => replacementByToken.get(token) ?? token);
}

/**
 * Deep, immutable substitution over every string value reachable from
 * `value` (objects/arrays walked recursively; primitives returned as-is).
 * Applied to the WHOLE `CompiledWorkerProfile` — not only the fields
 * roadmap/06's own text enumerates (`permissions.{allow,deny,ask}`,
 * `sandbox.filesystem.{allowWrite,denyRead}`, `settingsJson`) — because
 * `sdkOptions.allowedTools`/`disallowedTools` are literally the SAME
 * arrays as `permissions.allow`/`deny` ("one compiled decision, two
 * serializations", `worker-settings.ts`'s own doc comment); substituting
 * one but not its mirror would silently reintroduce the placeholder into
 * `assembleWorkerOptions`' own `allowedTools`/`disallowedTools` output.
 */
function substitutePlaceholdersDeep<T>(value: T, substitute: (text: string) => string): T {
  if (typeof value === "string") {
    return substitute(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => substitutePlaceholdersDeep(item, substitute)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, child]) => [key, substitutePlaceholdersDeep(child, substitute)] as const,
    );
    return Object.fromEntries(entries) as unknown as T;
  }
  return value;
}

/**
 * Substitutes engine-core's `<worktree>`/`<worker-tmp>` placeholder tokens
 * (`WORKTREE_WRITE_PLACEHOLDER`/`WORKER_TMP_WRITE_PLACEHOLDER`) with the
 * real absolute `worktreePath`/`workerTmp` paths, everywhere they occur in
 * `profile` — a fresh, deep, immutable copy; `profile` itself is never
 * mutated.
 *
 * `assertNoFootguns(profile)` runs FIRST, against the PRE-substitution
 * profile — its invariants (e.g. "every `Edit`/`Write` allow rule is
 * anchored under `WORKTREE_WRITE_PLACEHOLDER`") are expressed in
 * placeholder form and would misfire against already-substituted values.
 *
 * ENGINE-FACT-DRIFT (mandatory per CLAUDE.md's engine-fact-drift ground
 * rule, carried forward from engine-core's `owned-path.ts`'s own
 * unresolved-carry-forward note): substitution here is literal, uniform
 * substring replacement — no special-casing of the `//`-anchored
 * permission-rule form (`Edit(//${WORKTREE_WRITE_PLACEHOLDER}/rel/**)`)
 * vs. the bare sandbox-filesystem form (`[WORKTREE_WRITE_PLACEHOLDER]`).
 * Because `worktreePath` is itself validated absolute (leading `/`) and
 * the permission-rule template already embeds the placeholder directly
 * after a literal `//` prefix, the substituted permission-rule form is
 * `Edit(///abs/worktree/rel/**)` (three slashes), while the sandbox
 * `filesystem.allowWrite` form (no `//` prefix in its template) becomes a
 * clean single-leading-slash absolute path. `docs/engine-baseline.md` §3
 * records no path-anchor probe at all (only Bash-prefix/colon-spacing
 * behavior) — the real engine's exact matching semantics for the
 * `//`-anchored form remain UNPROBED, exactly as engine-core's
 * `owned-path.ts` already flags. This worker did not invent an alternate
 * (e.g. slash-stripping) substitution rule to paper over that gap; the
 * mechanically simplest, most literal, most auditable interpretation was
 * chosen instead, and the golden fixtures under `../goldens/` reflect it
 * byte-for-byte. Carried forward to the interface-ledger reconcile
 * alongside `owned-path.ts`'s own carried-forward gap — this is this
 * package's own `@live` conformance suite's (W5's) probe to close.
 */
export function substituteWorktreePlaceholders(
  profile: CompiledWorkerProfile,
  worktreePath: string,
  workerTmp: string,
): CompiledWorkerProfile {
  assertSafeAbsolutePath("worktreePath", worktreePath);
  assertSafeAbsolutePath("workerTmp", workerTmp);

  assertNoFootguns(profile);

  const substitute = buildSinglePassSubstituter([
    [WORKTREE_WRITE_PLACEHOLDER, worktreePath],
    [WORKER_TMP_WRITE_PLACEHOLDER, workerTmp],
  ]);

  return substitutePlaceholdersDeep(profile, substitute);
}

// ---------------------------------------------------------------------------
// assembleWorkerOptions
// ---------------------------------------------------------------------------

/**
 * The pre-assigned-`sessionId` vs. `resume`(+`forkSession`) choice —
 * mutually exclusive on the SDK's own `Options` shape (sdk.d.ts:
 * "`sessionId` … Cannot be used with `continue` or `resume` unless
 * `forkSession` is also set"). README design decision 2: the adapter
 * always pre-generates and journals the UUID before spawn; `"assign"` is
 * that first-spawn path, `"resume"` is the crash-recovery/rate-limit
 * re-dispatch path (roadmap/06 §In scope, work item 5).
 */
export type WorkerSessionSpec =
  | { readonly mode: "assign"; readonly sessionId: string }
  | { readonly mode: "resume"; readonly sessionRef: string; readonly forkSession?: boolean };

/**
 * Input to `assembleWorkerOptions`. Every field the pure assembler needs —
 * no implicit reads of `process.env`/`fs` anywhere in this module; the
 * caller (W4's `adapter.ts`) resolves all of it first.
 */
export interface AssembleWorkerOptionsInput {
  /** `compileEnvelope`'s output — PRE-substitution (placeholder form). */
  readonly profile: CompiledWorkerProfile;
  /** Absolute, supervisor-provisioned worktree path (07's layout). */
  readonly worktreePath: string;
  /** Absolute, supervisor-provisioned per-worker tmp path. */
  readonly workerTmp: string;
  /** `buildWorkerEnv`'s output — passed in, not recomputed here. */
  readonly env: Readonly<Record<string, string>>;
  /** Pre-assigned session UUID, or a `resume`(+`forkSession`) request. */
  readonly session: WorkerSessionSpec;
  /** Maximum conversation turns (from the `TaskPacket`). */
  readonly maxTurns: number;
  /** The `WorkerResult` JSON Schema `outputFormat.schema` validates against. */
  readonly resultSchema: Record<string, unknown>;
  /** Role preamble appended to the `claude_code` system-prompt preset. */
  readonly rolePreamble?: string;
  /** Model override; defaults to `DEFAULT_WORKER_MODEL` when omitted. */
  readonly model?: string;
  /** Test seam: overrides the gateway MCP server entry VALUE only. */
  readonly gatewayServerOverride?: Readonly<Record<string, unknown>>;
  /** Passthrough: the real `AdjudicationCallback` bridge (W3/W4 supply this). */
  readonly canUseTool?: Options["canUseTool"];
  /** Passthrough: audit/evidence hooks (W3/W4 supply this). */
  readonly hooks?: Options["hooks"];
  /** Passthrough: cancellation controller (W4 supplies this). */
  readonly abortController?: AbortController;
  /** Passthrough: engine executable override (W4 supplies this). */
  readonly pathToClaudeCodeExecutable?: string;
}

function toSessionFields(
  session: WorkerSessionSpec,
): Pick<Options, "sessionId" | "resume" | "forkSession"> {
  if (session.mode === "assign") {
    return { sessionId: session.sessionId };
  }
  return {
    resume: session.sessionRef,
    ...(session.forkSession === undefined ? {} : { forkSession: session.forkSession }),
  };
}

/**
 * Maps the compiled (already-substituted) `SandboxProfile` onto the SDK's
 * own `Options.sandbox` shape (`SandboxSettings`). Field names already
 * align 1:1 (engine-core's `sandbox-profile.ts` was built directly against
 * `docs/engine-baseline.md` §6's schema correction: `allowAllUnixSockets`
 * as a boolean, NEVER the macOS-only `allowUnixSockets` string-array
 * field) — this function's job is the explicit, defensive re-construction
 * (fresh arrays/objects), not a field rename.
 */
function toSdkSandboxSettings(sandbox: CompiledWorkerProfile["sandbox"]): SandboxSettings {
  return {
    enabled: sandbox.enabled,
    failIfUnavailable: sandbox.failIfUnavailable,
    allowUnsandboxedCommands: sandbox.allowUnsandboxedCommands,
    network: {
      allowedDomains: [...sandbox.network.allowedDomains],
      allowAllUnixSockets: sandbox.network.allowAllUnixSockets,
      allowLocalBinding: sandbox.network.allowLocalBinding,
    },
    filesystem: {
      allowWrite: [...sandbox.filesystem.allowWrite],
      denyRead: [...sandbox.filesystem.denyRead],
    },
    credentials: {
      envVars: sandbox.credentials.envVars.map((entry) => ({ ...entry })),
    },
  };
}

/**
 * Assembles the concrete SDK `query()` `Options` for one worker spawn —
 * the "worker-profile assembler" roadmap/06 work item 1 names, and the
 * subject of this module's golden-fixture test (`options-assembler.test.ts`).
 * Every field is set exactly per README design decisions 2/4/5/6/7/9 and
 * roadmap/06's own "Spawn path" bullet; nothing here reads `fs`/`process.env`.
 */
export function assembleWorkerOptions(input: AssembleWorkerOptionsInput): Options {
  const substituted = substituteWorktreePlaceholders(
    input.profile,
    input.worktreePath,
    input.workerTmp,
  );

  return {
    cwd: input.worktreePath,
    env: { ...input.env },
    ...toSessionFields(input.session),
    settingSources: [],
    permissionMode: "dontAsk",
    allowedTools: [...substituted.sdkOptions.allowedTools],
    disallowedTools: [...substituted.sdkOptions.disallowedTools],
    strictMcpConfig: true,
    mcpServers: buildGatewayMcpServers(input.gatewayServerOverride),
    settings: substituted.settingsJson,
    sandbox: toSdkSandboxSettings(substituted.sandbox),
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      ...(input.rolePreamble === undefined ? {} : { append: input.rolePreamble }),
    },
    model: resolveWorkerModel(input.model),
    maxTurns: input.maxTurns,
    outputFormat: { type: "json_schema", schema: input.resultSchema },
    includePartialMessages: true,
    ...(input.canUseTool === undefined ? {} : { canUseTool: input.canUseTool }),
    ...(input.hooks === undefined ? {} : { hooks: input.hooks }),
    ...(input.abortController === undefined ? {} : { abortController: input.abortController }),
    ...(input.pathToClaudeCodeExecutable === undefined
      ? {}
      : { pathToClaudeCodeExecutable: input.pathToClaudeCodeExecutable }),
  };
}
