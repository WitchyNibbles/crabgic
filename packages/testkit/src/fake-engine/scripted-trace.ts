import { type WorkerResult } from "@eo/contracts";
import { buildWorkerResult } from "../fixtures/worker-result.js";
import { createIdProvider } from "../providers/id-provider.js";
import type { FakeToolCall } from "./tool-call.js";
import type { RateLimitEventPayload } from "./rate-limit-fixtures.js";

/**
 * `FakeEngineScript` — the scriptable-trace input the fake engine replays
 * (roadmap/03-envelope-compiler-engine-adapter.md §In scope, "Fake engine"
 * bullet: "replays scripted tool-call traces ... seeded from 00's
 * `spikes/fixtures/`"). One instance = one worker session's entire
 * lifecycle, including an optional `onResume` continuation script (for the
 * crash/resume scenario, docs/engine-baseline.md §7).
 */
export interface FakeToolCallStep extends FakeToolCall {
  /** Canned tool_result text emitted alongside the toolUse event, when the call is allowed. */
  readonly toolResult?: string;
}

/**
 * Injectable failure modes (roadmap/03 §In scope: "injectable failure
 * modes ... crash, `limitSignal` ..., schema-violating result ..., hang/
 * timeout"). `atStepIndex` is a checkpoint index into `toolCalls`
 * (0..toolCalls.length inclusive — `toolCalls.length` means "after the
 * last scripted call, before assistant/result"); default `0` (immediately
 * after `init`).
 */
export type FakeEngineFailureMode =
  | { readonly kind: "crash"; readonly atStepIndex?: number }
  | { readonly kind: "limitSignal"; readonly payload?: RateLimitEventPayload }
  | { readonly kind: "schemaViolation" }
  | { readonly kind: "hang"; readonly atStepIndex?: number };

export interface FakeEngineScript {
  readonly sessionId: string;
  readonly projectDirectory: string;
  readonly worktreePath: string;
  readonly configDir: string;
  readonly model: string;
  readonly cwd: string;
  readonly tools: readonly string[];
  readonly mcpServers: readonly string[];
  readonly toolCalls: readonly FakeToolCallStep[];
  readonly assistantText?: string;
  /**
   * Normal-path terminal payload — deliberately typed `WorkerResult`
   * (@eo/contracts), not a loose record, so a script's default output
   * provably "conforms to WorkerResult" (this worker's brief, deliverable
   * 1). The `schemaViolation` failure mode overrides this to `undefined`
   * on the emitted `result` event, matching docs/engine-baseline.md §5's
   * exact observed shape (`subtype:"success"`, `structured_output:
   * undefined`, no retry) — never this field's own absence.
   */
  readonly structuredOutput: WorkerResult;
  readonly totalCostUsd?: number;
  readonly failure?: FakeEngineFailureMode;
  /** Continuation script for `EngineAdapter.resume()` — see docs/engine-baseline.md §7's kill9-resume shape. */
  readonly onResume?: FakeEngineScript;
}

/** Every field defaults to a neutral/empty value; callers override only what the scenario under test needs. */
export function buildFakeEngineScript(overrides: Partial<FakeEngineScript> = {}): FakeEngineScript {
  const sessionId = createIdProvider(0).next();
  const defaults: FakeEngineScript = {
    sessionId,
    projectDirectory: "/fake/project",
    worktreePath: "/fake/project/worktree",
    configDir: "/fake/project/.claude-config",
    model: "claude-haiku-4-5-20251001",
    cwd: "/fake/project/worktree",
    tools: ["Bash", "Edit", "Write", "Read"],
    mcpServers: [],
    toolCalls: [],
    structuredOutput: buildWorkerResult(),
  };
  return { ...defaults, ...overrides };
}
