/**
 * `ClaudeEngineAdapter` — the real `EngineAdapter` (`@eo/engine-core`)
 * implementation over `@anthropic-ai/claude-agent-sdk` (roadmap/06-claude-
 * engine-adapter.md work items 1/5/6; README design decisions 1, 2, 12).
 * Composes every sibling module in this package (`options-assembler.ts`,
 * `auth.ts`, `version-gate.ts`, `event-normalizer.ts`, `adjudication-
 * policy.ts`'s bridge shape, `hooks.ts`, `result-validation.ts`'s consumer
 * contract, `session.ts`) — this file and `session.ts` are the ONLY place
 * in this package that constructs a real `ClaudeEngineAdapter`; every
 * sibling module's exported signature is treated as frozen (per this
 * worker's brief, "do not modify").
 *
 * SINGLE SDK BOUNDARY (README decision 1): the only call to `config.sdkQuery`
 * (defaulting to the real SDK `query`) lives in `buildHandle`'s lazy
 * generator body, below.
 *
 * RESUME/FORK WITHOUT A PACKET — A DOCUMENTED DESIGN DECISION: 03's frozen
 * `EngineAdapter.resume(sessionRef, adjudicate)`/this package's own `fork`
 * extension carry NO `TaskPacket`/`CompiledWorkerProfile` parameter, yet
 * `assembleWorkerOptions` (this package's "one compiled decision" pipeline)
 * requires `maxTurns`/`resultSchema`/`profile` to build a real `Options`
 * object — adaptation §5.3's own illustrative sample builds spawn AND
 * resume through the exact same combined `query()` call, confirming these
 * fields are expected on resume too, not merely on first spawn. This
 * adapter instance therefore caches `{packet, profile}` per `sessionId`,
 * populated at `spawn()`/carried forward at `resume()`/`fork()` time (`this
 * .spawnContexts`) — full-fidelity resume/fork is guaranteed whenever the
 * SAME `ClaudeEngineAdapter` instance that originally spawned a session is
 * still the one asked to resume it (exactly 05's own crash-detection ->
 * `onCrash` call site: the supervisor daemon process, and therefore this
 * adapter instance, survives an engine subprocess crash). When resume/fork
 * is asked for a `sessionId` this instance never itself spawned (a
 * genuinely cross-process resume — 13's own "restart-safe re-dispatch"
 * scenario, roadmap/13's text, not this phase's to solve durably), this
 * adapter falls back to `FALLBACK_SPAWN_CONTEXT`: a minimal, explicitly
 * documented, intentionally LOW-privilege profile (`compileEnvelope`'s own
 * `READ_ONLY_ENVELOPE` golden — already footgun-clean and exported) rather
 * than either throwing or guessing a permissive shape. Flagged as a
 * carry-forward open question for 13/05's cross-process durable-cache
 * reconciliation, per `docs/evidence/phase-06/wi4-adapter.md`.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type {
  AdjudicationCallback,
  AdjudicationDecision,
  CompiledWorkerProfile,
  EngineAdapter,
  EngineCapabilities,
  EngineEvent,
  SessionRef,
  WorkerHandle,
} from "@eo/engine-core";
import { assertNoFootguns, compileEnvelope, READ_ONLY_ENVELOPE } from "@eo/engine-core";
import {
  CURRENT_SCHEMA_VERSION,
  TaskPacketSchema,
  type TaskPacket,
  type Timestamp,
} from "@eo/contracts";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CanUseTool, Options, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeEngineAdapterConfig, SdkQueryFunction } from "./adapter-config.js";
import { assertEngineVersionAccepted } from "./version-gate.js";
import { assembleWorkerOptions, type WorkerSessionSpec } from "./options-assembler.js";
import { provisionWorkerAuth, buildWorkerEnv } from "./auth.js";
import { normalizeSdkStream } from "./event-normalizer.js";
import {
  createInMemoryAdjudicationAuditLog,
  createPostToolUseAuditHook,
  createSessionEndEvidenceHook,
  type AdjudicationAuditLog,
  type AdjudicationAuditViolation,
} from "./hooks.js";
import { createSessionRef } from "./session.js";

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Thrown by the default `engineVersionResolver` when the installed SDK's
 * own `package.json` version cannot be read or mapped to an engine version
 * (docs/engine-baseline.md header: SDK `0.3.x` pairs with engine `2.1.x`).
 */
export class EngineVersionResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineVersionResolutionError";
  }
}

/**
 * Thrown by `spawn` when `packet` fails `@eo/contracts`' `TaskPacketSchema`
 * (boundary-validation rule: every external input is validated at the
 * boundary it crosses, never trusted merely because it is typed).
 */
export class TaskPacketValidationError extends Error {
  constructor(issues: readonly string[]) {
    super(`TaskPacket failed boundary validation against TaskPacketSchema: ${issues.join("; ")}`);
    this.name = "TaskPacketValidationError";
  }
}

/**
 * Thrown from inside the event-stream generator the moment the PostToolUse
 * audit hook (`hooks.ts`) has recorded a GENUINE executed-vs-adjudicated
 * mismatch — a tool this session DID adjudicate as `allow` whose executed
 * input matched none of the adjudicated inputs (Finding 2's tightened audit
 * contract). A tool with zero adjudicated records (authorized by the static
 * `dontAsk` allow-list, baseline §3) is NOT a violation and never lands
 * here, and a hook-internal error is recorded as an `auditFailure`, not a
 * violation — so reaching this abort path always means a real
 * adjudicated-vs-executed mismatch was detected. The generator's own
 * `abortController` is aborted first (README decision 12's fail-closed
 * posture applied to a POST-hoc detection, not only the pre-hoc
 * `canUseTool` bridge); this error is thrown after that, so the worker's
 * own event consumer (05's `worker-lifecycle-manager`, whose
 * `pumpWorkerEvents` already treats a thrown iterator identically to an
 * abrupt/crashed stream end) reacts exactly like any other crash.
 */
export class AdjudicationAuditViolationError extends Error {
  constructor(readonly violations: readonly AdjudicationAuditViolation[]) {
    super(
      `worker aborted: PostToolUse audit detected ${String(violations.length)} executed-vs-` +
        "adjudicated mismatch(es) — the engine executed a tool call whose input did not match " +
        "what this session's adjudication policy actually allowed",
    );
    this.name = "AdjudicationAuditViolationError";
  }
}

// ---------------------------------------------------------------------------
// Default `engineVersionResolver` (docs/engine-baseline.md header pairing)
// ---------------------------------------------------------------------------

/**
 * SDK `major.minor` -> engine `major.minor` pairing this package's default
 * resolver mirrors (docs/engine-baseline.md header: "Tested version: `claude`
 * CLI **2.1.210** ... `@anthropic-ai/claude-agent-sdk` **0.3.210**"). The
 * patch digit tracks whatever the installed SDK's own `package.json`
 * reports (exact-pinned per 01's engine-pin-lint policy) — this map only
 * pins the major.minor PREFIX translation, never a specific patch.
 */
const SDK_TO_ENGINE_VERSION_PREFIX_MAP: Readonly<Record<string, string>> = {
  "0.3": "2.1",
};

/** Exported for direct unit-testing only (`adapter.test.ts`) — NOT re-exported through the package's public `[W4-EXPORTS]` anchor line. */
export function mapSdkVersionToEngineVersion(sdkVersion: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(sdkVersion);
  const sdkMajor = match?.[1];
  const sdkMinor = match?.[2];
  const patch = match?.[3];
  if (sdkMajor === undefined || sdkMinor === undefined || patch === undefined) {
    throw new EngineVersionResolutionError(
      "@anthropic-ai/claude-agent-sdk package version is not a plain <major>.<minor>.<patch> " +
        `triple: ${JSON.stringify(sdkVersion)}`,
    );
  }
  const enginePrefix = SDK_TO_ENGINE_VERSION_PREFIX_MAP[`${sdkMajor}.${sdkMinor}`];
  if (enginePrefix === undefined) {
    throw new EngineVersionResolutionError(
      `no known SDK-to-engine version mapping for SDK ${sdkMajor}.${sdkMinor}.x ` +
        "(docs/engine-baseline.md header pairs SDK 0.3.x with engine 2.1.x)",
    );
  }
  return `${enginePrefix}.${patch}`;
}

/**
 * Walks upward from `startDir` (bounded — the SDK's own `package.json` is
 * always at, or one level above, its resolved entry file) looking for a
 * `package.json`. CORRECTION vs. this worker's original brief (`require
 * .resolve("@anthropic-ai/claude-agent-sdk/package.json")`): the installed
 * SDK's own `package.json` `exports` map (verified directly against the
 * installed 0.3.210 package) does NOT list a `"./package.json"` subpath —
 * only `".", "./extract", "./browser", "./bridge", "./sdk-tools",
 * "./sdk-tools.js"` — so that exact `require.resolve` call throws
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` (reproduced directly, not assumed). This
 * function instead resolves the package's own main ENTRY file (a subpath
 * `exports` always allows) and walks upward from its directory to find the
 * nearest `package.json`, which for this package's own `"."` export
 * (`sdk.mjs`, directly at the package root) resolves on the first
 * iteration.
 */
/** Exported for direct unit-testing only (`adapter.test.ts`) — NOT re-exported through the package's public `[W4-EXPORTS]` anchor line. */
export function findNearestPackageJson(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 5; i += 1) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new EngineVersionResolutionError(
    "could not locate @anthropic-ai/claude-agent-sdk's own package.json by walking up from its resolved entry point",
  );
}

/**
 * Default `ClaudeEngineAdapterConfig.engineVersionResolver`: reads the
 * exact installed `@anthropic-ai/claude-agent-sdk` version via a
 * `node:module` `createRequire`-resolved entry point (never a bundled
 * import of the SDK's own metadata, which strict TS/ESM has no stable way
 * to type) and maps it to the paired engine version.
 */
function defaultEngineVersionResolver(): string {
  const require = createRequire(import.meta.url);
  const entryPath = require.resolve("@anthropic-ai/claude-agent-sdk");
  const packageJsonPath = findNearestPackageJson(dirname(entryPath));
  const raw = readFileSync(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as { readonly version?: unknown };
  if (typeof parsed.version !== "string") {
    throw new EngineVersionResolutionError(
      "@anthropic-ai/claude-agent-sdk's package.json has no string 'version' field",
    );
  }
  return mapSdkVersionToEngineVersion(parsed.version);
}

// ---------------------------------------------------------------------------
// TaskPacket boundary validation
// ---------------------------------------------------------------------------

function parseTaskPacketOrThrow(packet: TaskPacket): TaskPacket {
  const parsed = TaskPacketSchema.safeParse(packet);
  if (!parsed.success) {
    throw new TaskPacketValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.code}`),
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Fallback spawn context for an uncached resume/fork (see top-of-file doc).
// ---------------------------------------------------------------------------

interface SpawnContext {
  readonly packet: TaskPacket;
  readonly profile: CompiledWorkerProfile;
}

/** This package's own conservative default — not a baseline-cited engine fact. */
const FALLBACK_MAX_TURNS = 20;

const FALLBACK_TASK_PACKET: TaskPacket = TaskPacketSchema.parse({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: "00000000-0000-4000-8000-000000000001",
  workUnitId: "00000000-0000-4000-8000-000000000000",
  requirementIds: [],
  objective:
    "Resume a session with no cached spawn context on this adapter instance (cross-process " +
    "resume fallback — see ClaudeEngineAdapter's top-of-file doc comment).",
  nonGoals: [],
  baseObjectId: "fallback-resume-context",
  relevantInterfaces: [],
  ownedPaths: [],
  constraints: [],
  resourceLimits: { maxTurns: FALLBACK_MAX_TURNS },
  gates: [],
  resultSchema: { type: "object" },
});

/**
 * `compileEnvelope(READ_ONLY_ENVELOPE)` — already footgun-clean and
 * exported by `@eo/engine-core`'s own golden fixtures; reused here rather
 * than hand-authoring a second minimal-profile literal.
 */
const FALLBACK_PROFILE: CompiledWorkerProfile = compileEnvelope(READ_ONLY_ENVELOPE);

const FALLBACK_SPAWN_CONTEXT: SpawnContext = {
  packet: FALLBACK_TASK_PACKET,
  profile: FALLBACK_PROFILE,
};

// ---------------------------------------------------------------------------
// Prompt assembly (this package's own scoped decision — TaskPacketSchema,
// 02's real/current schema, has no single "prompt" field the way
// adaptation §5.3's illustrative sample assumes; this is a deterministic
// serialization of the packet's own fields, not a baseline-cited fact).
// ---------------------------------------------------------------------------

const RESUME_PROMPT = "Continue the previous session.";
const FORK_PROMPT = "Continue the previous session in this isolated fork.";

function bulletList(label: string, items: readonly string[]): string | undefined {
  if (items.length === 0) {
    return undefined;
  }
  return `${label}:\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function buildPromptFromTaskPacket(packet: TaskPacket): string {
  const sections = [
    `Objective: ${packet.objective}`,
    bulletList("Non-goals", packet.nonGoals),
    bulletList("Constraints", packet.constraints),
    bulletList("Relevant interfaces", packet.relevantInterfaces),
    bulletList("Owned paths", packet.ownedPaths),
  ].filter((section): section is string => section !== undefined);
  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// `canUseTool` bridge (README decision 12: fail-closed, journal-first via
// 05's own bus — this bridge is the `AdjudicationCallback` -> SDK
// `CanUseTool` shape translation; near-identical shapes per roadmap/06
// work item 3).
// ---------------------------------------------------------------------------

const GENERIC_ADJUDICATION_FAILURE_MESSAGE =
  "tool call denied: adjudication was unavailable (the callback threw, rejected, or is absent) " +
  "— failing closed";

function createCanUseToolBridge(params: {
  readonly adjudicate: AdjudicationCallback;
  readonly audit: AdjudicationAuditLog;
}): CanUseTool {
  return async (toolName, input, options) => {
    let decision: AdjudicationDecision;
    try {
      decision = await params.adjudicate(toolName, input, { signal: options.signal });
    } catch {
      // Fail-closed (README decision 12): a throwing/rejecting adjudicate
      // callback (or one that is missing/`undefined`, which throws a
      // TypeError the moment it is invoked) is caught here identically —
      // NEVER an allow.
      decision = { behavior: "deny", message: GENERIC_ADJUDICATION_FAILURE_MESSAGE };
    }
    if (decision.behavior === "allow") {
      params.audit.recordAllowedDecision(toolName, decision.updatedInput);
      const allowResult: PermissionResult = {
        behavior: "allow",
        updatedInput: decision.updatedInput,
      };
      return allowResult;
    }
    const denyResult: PermissionResult = {
      behavior: "deny",
      message: decision.message,
      ...(decision.interrupt === undefined ? {} : { interrupt: decision.interrupt }),
    };
    return denyResult;
  };
}

// ---------------------------------------------------------------------------
// cancel()'s termination-ladder mirror (05's `termination-ladder.ts` fix,
// at this package's own abstraction layer — an `AbortController` + a
// generator, not an OS process handle).
// ---------------------------------------------------------------------------

/** Resolves `true` if `ended` did NOT settle within `graceMs` (a timeout), `false` if it settled first. */
async function timedOutWaitingFor(ended: Promise<void>, graceMs: number): Promise<boolean> {
  let finishedInTime = false;
  const tracked = ended.then(() => {
    finishedInTime = true;
  });
  await Promise.race([
    tracked,
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, graceMs);
      timer.unref?.();
    }),
  ]);
  return !finishedInTime;
}

interface ActiveStreamControl {
  readonly abortController: AbortController;
  /** Resolves once the generator body has finished (return, throw, or an externally-forced `.return()`) — set in a `finally` block, independent of who (if anyone) is pulling `.next()`. */
  readonly ended: Promise<void>;
  readonly generator: AsyncGenerator<EngineEvent>;
}

// ---------------------------------------------------------------------------
// buildHandle — the shared pipeline behind spawn/resume/fork.
// ---------------------------------------------------------------------------

interface BuildHandleParams {
  readonly sessionRef: SessionRef;
  readonly session: WorkerSessionSpec;
  readonly profile: CompiledWorkerProfile;
  readonly maxTurns: number;
  readonly resultSchema: Record<string, unknown>;
  readonly workUnitId: string;
  readonly adjudicate: AdjudicationCallback;
  readonly prompt: string;
  /**
   * Adapter-level `Options` overrides applied AFTER `assembleWorkerOptions`
   * — `fork`'s `{resume: originalId, forkSession: true}` combined with a
   * freshly-assigned `sessionId` (sdk.d.ts's sanctioned combination).
   * `options-assembler.ts`'s own `WorkerSessionSpec` (frozen, not modified
   * by this worker) has no slot expressing "assign AND resume" together,
   * so this adapter enriches the assembled `Options` itself rather than
   * asking that sibling module to grow a new variant.
   */
  readonly optionsOverride?: Partial<Options>;
}

export class ClaudeEngineAdapter implements EngineAdapter {
  private readonly engineVersionResolver: () => string;
  private readonly sdkQueryFn: SdkQueryFunction;
  private readonly spawnContexts = new Map<string, SpawnContext>();
  private readonly activeStreams = new WeakMap<WorkerHandle, ActiveStreamControl>();

  constructor(private readonly config: ClaudeEngineAdapterConfig) {
    this.engineVersionResolver = config.engineVersionResolver ?? defaultEngineVersionResolver;
    this.sdkQueryFn = config.sdkQuery ?? query;
  }

  spawn(
    packet: TaskPacket,
    profile: CompiledWorkerProfile,
    adjudicate: AdjudicationCallback,
  ): WorkerHandle {
    // Synchronous, BEFORE any engine invocation (exit criterion:
    // "spawn/resume refuse to start outside the accepted version range" —
    // zero sdkQuery calls, zero journal entries, proven by a probe).
    assertEngineVersionAccepted(this.engineVersionResolver());

    const parsedPacket = parseTaskPacketOrThrow(packet);
    assertNoFootguns(profile);

    const sessionRef = createSessionRef({
      worktreePath: this.config.worktreePath,
      configDir: this.config.provisioning.CLAUDE_CONFIG_DIR,
    });
    this.spawnContexts.set(sessionRef.sessionId, { packet: parsedPacket, profile });

    return this.buildHandle({
      sessionRef,
      session: { mode: "assign", sessionId: sessionRef.sessionId },
      profile,
      maxTurns: parsedPacket.resourceLimits.maxTurns,
      resultSchema: parsedPacket.resultSchema,
      workUnitId: parsedPacket.workUnitId,
      adjudicate,
      prompt: buildPromptFromTaskPacket(parsedPacket),
    });
  }

  resume(sessionRef: SessionRef, adjudicate: AdjudicationCallback): WorkerHandle {
    assertEngineVersionAccepted(this.engineVersionResolver());

    const context = this.spawnContexts.get(sessionRef.sessionId) ?? FALLBACK_SPAWN_CONTEXT;
    this.spawnContexts.set(sessionRef.sessionId, context);

    return this.buildHandle({
      sessionRef,
      session: { mode: "resume", sessionRef: sessionRef.sessionId },
      profile: context.profile,
      maxTurns: context.packet.resourceLimits.maxTurns,
      resultSchema: context.packet.resultSchema,
      workUnitId: context.packet.workUnitId,
      adjudicate,
      prompt: RESUME_PROMPT,
    });
  }

  /**
   * Extension method beyond 03's frozen `EngineAdapter` interface (13's
   * repair-attempt isolation, roadmap/06 §In scope, work item 5). A fresh
   * UUID via `session.ts`'s `createSessionRef`; `Options { resume:
   * <original sessionId>, forkSession: true, sessionId: <new UUID> }`
   * (sdk.d.ts sanctions this exact combination); the NEW id is journaled
   * (never the original — `buildHandle`'s own `session_assignment` append
   * always uses `params.sessionRef.sessionId`, which here is the fork's
   * own new id).
   */
  fork(sessionRef: SessionRef, adjudicate: AdjudicationCallback): WorkerHandle {
    assertEngineVersionAccepted(this.engineVersionResolver());

    const context = this.spawnContexts.get(sessionRef.sessionId) ?? FALLBACK_SPAWN_CONTEXT;
    const forkedSessionRef = createSessionRef({
      worktreePath: sessionRef.worktreePath,
      configDir: sessionRef.configDir,
    });
    this.spawnContexts.set(forkedSessionRef.sessionId, context);

    return this.buildHandle({
      sessionRef: forkedSessionRef,
      session: { mode: "assign", sessionId: forkedSessionRef.sessionId },
      profile: context.profile,
      maxTurns: context.packet.resourceLimits.maxTurns,
      resultSchema: context.packet.resultSchema,
      workUnitId: context.packet.workUnitId,
      adjudicate,
      prompt: FORK_PROMPT,
      optionsOverride: { resume: sessionRef.sessionId, forkSession: true },
    });
  }

  async cancel(handle: WorkerHandle, deadline: Timestamp): Promise<void> {
    const control = this.activeStreams.get(handle);
    if (control === undefined) {
      // Never throws for an already-terminated/unknown handle (frozen
      // `EngineAdapter.cancel` contract).
      return;
    }
    control.abortController.abort();
    const graceMs = Math.max(0, new Date(deadline).getTime() - Date.now());
    const timedOut = await timedOutWaitingFor(control.ended, graceMs);
    if (timedOut) {
      // Mirrors 05's `termination-ladder.ts`: best-effort, deliberately NOT
      // awaited (a truly wedged generator's `.return()` might never settle
      // either).
      control.generator.return?.(undefined)?.catch(() => {
        // Best-effort only.
      });
    }
  }

  capabilities(): EngineCapabilities {
    return {
      supportsJsonSchema: true,
      supportsSessionResume: true,
      permissionModel: "dontAsk",
      sandboxModel: "bubblewrap",
      engineVersion: this.engineVersionResolver(),
    };
  }

  private buildHandle(params: BuildHandleParams): WorkerHandle {
    // Destructured (not aliased-whole `this`, which @typescript-eslint/no-
    // this-alias forbids) so the nested `function* run()` below — which
    // does NOT lexically bind `this` — can still reach these two fields.
    const { config, sdkQueryFn } = this;
    const abortController = new AbortController();
    let resolveEnded!: () => void;
    const ended = new Promise<void>((resolve) => {
      resolveEnded = resolve;
    });

    async function* run(): AsyncGenerator<EngineEvent> {
      try {
        // (a) Pre-spawn `session_assignment` — journaled BEFORE this
        // generator makes its own `sdkQueryFn` call, i.e. before the engine
        // subprocess this adapter starts can exist (README decision 2).
        // NOTE on ordering vs. 05: `spawnManagedWorker` appends its OWN
        // `session_assignment` entry synchronously right after `spawn()`
        // returns — before it even builds the events iterator, so 05's entry
        // actually lands FIRST and this generator's entry (written when the
        // iterator is first pulled) lands second. The two are a tolerated
        // duplicate (recovery.ts tracks the LATEST entry per session), and
        // the load-bearing invariant still holds either way: THIS append
        // completes before THIS generator's `sdkQueryFn` call below, so the
        // session is journaled before the engine subprocess exists. 05's code
        // is unchanged by design (roadmap/06 §Out of scope).
        await config.journal.appendEntry({
          type: "session_assignment",
          ...(config.runId !== undefined ? { runId: config.runId } : {}),
          workUnitId: params.workUnitId,
          payload: { sessionId: params.sessionRef.sessionId },
        });

        // (b) auth + env.
        const authEnv = await provisionWorkerAuth(config.auth, params.sessionRef.configDir);
        const env = buildWorkerEnv({
          hostPath: process.env.PATH ?? "",
          provisioning: {
            HOME: config.provisioning.HOME,
            TMP: config.provisioning.TMP,
            CLAUDE_CONFIG_DIR: params.sessionRef.configDir,
          },
          authEnv,
        });

        // (d) audit log + hooks + canUseTool bridge (one per spawn/resume/fork).
        const audit = createInMemoryAdjudicationAuditLog();
        const canUseTool = createCanUseToolBridge({ adjudicate: params.adjudicate, audit });
        const postToolUseAuditHook = createPostToolUseAuditHook({ audit });
        const sessionEndEvidenceHook = createSessionEndEvidenceHook({
          journal: config.journal,
          ...(config.runId === undefined ? {} : { runId: config.runId }),
          workUnitId: params.workUnitId,
          sessionId: params.sessionRef.sessionId,
          projectDirectory: params.sessionRef.projectDirectory,
          configDir: params.sessionRef.configDir,
        });

        // (c) + assemble: `assembleWorkerOptions` internally calls
        // `substituteWorktreePlaceholders`, ALWAYS against
        // `params.sessionRef.worktreePath` — never this adapter's own
        // construction-time `config.worktreePath` directly — so resume/fork
        // can never substitute a different worktree than the one
        // `sessionRef` itself names (property test: `session.test.ts`).
        const assembled = assembleWorkerOptions({
          profile: params.profile,
          worktreePath: params.sessionRef.worktreePath,
          workerTmp: config.provisioning.TMP,
          env,
          session: params.session,
          maxTurns: params.maxTurns,
          resultSchema: params.resultSchema,
          ...(config.rolePreamble === undefined ? {} : { rolePreamble: config.rolePreamble }),
          ...(config.model === undefined ? {} : { model: config.model }),
          ...(config.gatewayServerOverride === undefined
            ? {}
            : { gatewayServerOverride: config.gatewayServerOverride }),
          canUseTool,
          hooks: {
            PostToolUse: [{ hooks: [postToolUseAuditHook] }],
            SessionEnd: [{ hooks: [sessionEndEvidenceHook.callback] }],
          },
          abortController,
          ...(config.pathToClaudeCodeExecutable === undefined
            ? {}
            : { pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable }),
        });
        const options: Options = { ...assembled, ...params.optionsOverride };

        // (e) the package's single SDK boundary (README decision 1).
        const stream = sdkQueryFn({ prompt: params.prompt, options });

        for await (const event of normalizeSdkStream(stream, params.sessionRef.sessionId)) {
          yield event;
          // (f) post-yield audit check: abort + end with a typed error the
          // moment the PostToolUse hook has recorded ANY executed-vs-
          // adjudicated mismatch. A stream that ends with no `result`
          // event (no violation ever recorded) is the ordinary crash
          // shape — this generator just ends; the caller's own
          // crash-detection (05's `pumpWorkerEvents`) handles it.
          if (audit.violations.length > 0) {
            abortController.abort();
            throw new AdjudicationAuditViolationError(audit.violations);
          }
        }
      } finally {
        resolveEnded();
      }
    }

    const generator = run();
    const handle: WorkerHandle = { sessionRef: params.sessionRef, events: generator };
    this.activeStreams.set(handle, { abortController, ended, generator });
    return handle;
  }
}
