import type {
  AdjudicationCallback,
  CompiledWorkerProfile,
  EngineAdapter,
  EngineCapabilities,
  EngineEvent,
  EnginePermissionDenial,
  SessionRef,
  WorkerHandle,
} from "@eo/engine-core";
import type { TaskPacket, Timestamp } from "@eo/contracts";
import { evaluateAllLayers } from "./layered-conformance.js";
import { RATE_LIMIT_ALLOWED_WARNING_96 } from "./rate-limit-fixtures.js";
import type { FakeEngineScript } from "./scripted-trace.js";

/**
 * `FakeEngineAdapter` — the scriptable `EngineAdapter` implementation
 * (roadmap/03-envelope-compiler-engine-adapter.md §In scope, "Fake
 * engine" bullet). Never spawns a subprocess or shells out to any binary
 * — `demo.test.ts`'s exit-criterion-5 requirement ("runs green in CI with
 * no `claude` binary installed") is satisfied by construction.
 */

export class FakeEngineUnknownSessionError extends Error {
  constructor(readonly sessionId: string) {
    super(`FakeEngineAdapter: no known session for sessionId ${sessionId}`);
    this.name = "FakeEngineUnknownSessionError";
  }
}

export class FakeEngineSessionScopeError extends Error {
  constructor(readonly sessionRef: SessionRef) {
    super(
      `FakeEngineAdapter: resume rejected — sessionRef scope (${sessionRef.projectDirectory}, ` +
        `${sessionRef.worktreePath}) does not match the session's original spawn scope`,
    );
    this.name = "FakeEngineSessionScopeError";
  }
}

export class FakeEngineNoResumeScriptError extends Error {
  constructor(readonly sessionId: string) {
    super(`FakeEngineAdapter: session ${sessionId} has no onResume continuation script configured`);
    this.name = "FakeEngineNoResumeScriptError";
  }
}

/** A gate an in-flight replay can `await`, released exactly once by `cancel()` (hang/timeout injection). */
class HangGate {
  private releaseFn: (() => void) | undefined;
  private readonly gate: Promise<void>;

  constructor() {
    this.gate = new Promise<void>((resolve) => {
      this.releaseFn = resolve;
    });
  }

  wait(): Promise<void> {
    return this.gate;
  }

  /** Idempotent — resolving an already-resolved promise a second time is a no-op. */
  open(): void {
    this.releaseFn?.();
  }
}

interface KnownSession {
  readonly projectDirectory: string;
  readonly worktreePath: string;
  readonly configDir: string;
  readonly profile: CompiledWorkerProfile;
  readonly resumeScript: FakeEngineScript | undefined;
}

async function* replayFakeEngineScript(
  script: FakeEngineScript,
  profile: CompiledWorkerProfile,
  adjudicate: AdjudicationCallback,
  hangGate: HangGate,
): AsyncGenerator<EngineEvent, void, void> {
  yield {
    type: "init",
    sessionId: script.sessionId,
    model: script.model,
    cwd: script.cwd,
    tools: script.tools,
    mcpServers: script.mcpServers,
  };

  const hangAtCheckpoint =
    script.failure?.kind === "hang" ? (script.failure.atStepIndex ?? 0) : undefined;
  const crashAtCheckpoint =
    script.failure?.kind === "crash" ? (script.failure.atStepIndex ?? 0) : undefined;
  const permissionDenials: EnginePermissionDenial[] = [];

  // Checkpoints run 0..toolCalls.length inclusive — the final checkpoint
  // (index === toolCalls.length) is "after every scripted call, before
  // assistant/result" so hang/crash can also fire with zero tool calls.
  for (let checkpoint = 0; checkpoint <= script.toolCalls.length; checkpoint += 1) {
    if (hangAtCheckpoint === checkpoint) {
      await hangGate.wait();
      return;
    }
    if (crashAtCheckpoint === checkpoint) {
      return;
    }
    if (checkpoint === script.toolCalls.length) {
      break;
    }
    const step = script.toolCalls[checkpoint];
    if (step === undefined) {
      break;
    }
    const verdict = await evaluateAllLayers(profile, step, adjudicate);
    if (verdict.overall === "deny") {
      permissionDenials.push({ toolName: step.toolName, toolInput: step.toolInput });
      continue;
    }
    yield {
      type: "toolUse",
      sessionId: script.sessionId,
      toolUseId: `fake-tool-use-${checkpoint}`,
      toolName: step.toolName,
      toolInput: step.toolInput,
      // exactOptionalPropertyTypes: an optional field must be omitted
      // entirely, never explicitly assigned `undefined`.
      ...(step.toolResult !== undefined ? { toolResult: step.toolResult } : {}),
    };
  }

  if (script.failure?.kind === "limitSignal") {
    const payload = script.failure.payload ?? RATE_LIMIT_ALLOWED_WARNING_96;
    yield { type: "limitSignal", sessionId: script.sessionId, ...payload };
  }

  if (script.assistantText !== undefined) {
    yield { type: "assistant", sessionId: script.sessionId, text: script.assistantText };
  }

  const structuredOutput =
    script.failure?.kind === "schemaViolation" ? undefined : script.structuredOutput;

  yield {
    type: "result",
    sessionId: script.sessionId,
    subtype: "success",
    isError: false,
    // exactOptionalPropertyTypes: omit rather than assign `undefined`.
    ...(structuredOutput !== undefined ? { structuredOutput } : {}),
    ...(script.totalCostUsd !== undefined ? { totalCostUsd: script.totalCostUsd } : {}),
    turnsUsed: script.toolCalls.length,
    permissionDenials,
  };
}

export class FakeEngineAdapter implements EngineAdapter {
  private readonly sessions = new Map<string, KnownSession>();
  private readonly hangGates = new Map<string, HangGate>();

  constructor(private readonly script: FakeEngineScript) {}

  spawn(
    _packet: TaskPacket,
    profile: CompiledWorkerProfile,
    adjudicate: AdjudicationCallback,
  ): WorkerHandle {
    return this.launch(this.script, profile, adjudicate);
  }

  resume(sessionRef: SessionRef, adjudicate: AdjudicationCallback): WorkerHandle {
    const known = this.sessions.get(sessionRef.sessionId);
    if (!known) {
      throw new FakeEngineUnknownSessionError(sessionRef.sessionId);
    }
    if (
      known.projectDirectory !== sessionRef.projectDirectory ||
      known.worktreePath !== sessionRef.worktreePath
    ) {
      throw new FakeEngineSessionScopeError(sessionRef);
    }
    if (!known.resumeScript) {
      throw new FakeEngineNoResumeScriptError(sessionRef.sessionId);
    }
    return this.launch(known.resumeScript, known.profile, adjudicate);
  }

  async cancel(handle: WorkerHandle, _deadline: Timestamp): Promise<void> {
    this.hangGates.get(handle.sessionRef.sessionId)?.open();
  }

  capabilities(): EngineCapabilities {
    return {
      supportsJsonSchema: true,
      supportsSessionResume: true,
      permissionModel: "fake-dontAsk",
      sandboxModel: "fake-bubblewrap",
      engineVersion: "0.0.0-fake",
    };
  }

  private launch(
    script: FakeEngineScript,
    profile: CompiledWorkerProfile,
    adjudicate: AdjudicationCallback,
  ): WorkerHandle {
    this.sessions.set(script.sessionId, {
      projectDirectory: script.projectDirectory,
      worktreePath: script.worktreePath,
      configDir: script.configDir,
      profile,
      resumeScript: script.onResume,
    });
    const hangGate = new HangGate();
    this.hangGates.set(script.sessionId, hangGate);
    const sessionRef: SessionRef = {
      sessionId: script.sessionId,
      projectDirectory: script.projectDirectory,
      worktreePath: script.worktreePath,
      configDir: script.configDir,
    };
    return { sessionRef, events: replayFakeEngineScript(script, profile, adjudicate, hangGate) };
  }
}
