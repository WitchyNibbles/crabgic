/**
 * `EngineEvent` — the typed event stream `EngineAdapter.spawn`/`resume`
 * expose via `WorkerHandle.events` (roadmap/03-envelope-compiler-engine-
 * adapter.md §In scope: "a typed `EngineEvent` stream: `init | assistant |
 * toolUse | result | retry | limitSignal`"). Each variant's payload is
 * grounded in docs/engine-baseline.md's recorded stream-json/
 * `rate_limit_event` shapes — see each interface's own doc comment for its
 * citation. `EngineEvent` is an adapter-level, NORMALIZED taxonomy over
 * the engine's raw stream-json/SDK message types, not a byte-for-byte
 * mirror of them (adaptation §4.5: transcript format "is documented as
 * unstable — treat as opaque evidence").
 */

export interface EngineInitEvent {
  readonly type: "init";
  readonly sessionId: string;
  readonly model: string;
  readonly cwd: string;
  readonly tools: readonly string[];
  readonly mcpServers: readonly string[];
}

export interface EngineAssistantEvent {
  readonly type: "assistant";
  readonly sessionId: string;
  readonly text: string;
}

export interface EngineToolUseEvent {
  readonly type: "toolUse";
  readonly sessionId: string;
  readonly toolUseId: string;
  readonly toolName: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
  readonly toolResult?: string;
}

export interface EnginePermissionDenial {
  readonly toolName: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
}

export interface EngineResultEvent {
  readonly type: "result";
  readonly sessionId: string;
  readonly subtype: string;
  readonly isError: boolean;
  readonly structuredOutput?: Readonly<Record<string, unknown>>;
  readonly totalCostUsd?: number;
  readonly turnsUsed?: number;
  readonly permissionDenials: readonly EnginePermissionDenial[];
}

export interface EngineRetryEvent {
  readonly type: "retry";
  readonly sessionId: string;
  readonly subtype: "api_retry";
}

/**
 * `limitSignal` payload — matches docs/engine-baseline.md §8's exact
 * recorded `rate_limit_event`/`rate_limit_info` schema verbatim (16
 * committed samples), completed by the SDK's own `SDKRateLimitInfo` type
 * declaration (baseline §8: "The SDK type declaration … confirms and
 * completes the schema"). `resetsAt` is an epoch-seconds number (baseline
 * §8: "keying reset timing on the machine-parseable epoch `resetsAt`").
 */
export type RateLimitStatus = "allowed" | "allowed_warning" | "rejected";

export type RateLimitType =
  | "five_hour"
  | "seven_day"
  | "seven_day_opus"
  | "seven_day_sonnet"
  | "seven_day_overage_included"
  | "overage";

export interface EngineLimitSignalEvent {
  readonly type: "limitSignal";
  readonly sessionId: string;
  readonly status: RateLimitStatus;
  readonly resetsAt: number;
  readonly rateLimitType?: RateLimitType;
  readonly utilization?: number;
  readonly surpassedThreshold?: number;
  readonly overageStatus?: string;
  readonly overageResetsAt?: number;
  readonly overageDisabledReason?: string;
  readonly isUsingOverage?: boolean;
  /** Baseline §8's typed `errorCode?: 'credits_required'` field. */
  readonly errorCode?: "credits_required";
}

export type EngineEvent =
  | EngineInitEvent
  | EngineAssistantEvent
  | EngineToolUseEvent
  | EngineResultEvent
  | EngineRetryEvent
  | EngineLimitSignalEvent;

export const ENGINE_EVENT_TYPES = [
  "init",
  "assistant",
  "toolUse",
  "result",
  "retry",
  "limitSignal",
] as const;

export type EngineEventType = (typeof ENGINE_EVENT_TYPES)[number];

export const ENGINE_EVENT_TYPE_DESCRIPTIONS: Readonly<Record<EngineEventType, string>> = {
  init: "The engine's system/init message (docs/engine-baseline.md §2, §4.4, §7).",
  assistant: "An assistant text turn/chunk (docs/engine-baseline.md §2, §5).",
  toolUse: "A completed tool_use/tool_result pair (docs/engine-baseline.md §3, §6).",
  result:
    "The engine's terminal result message (docs/engine-baseline.md §3 permission_denials, §4.4, §5, §7).",
  retry:
    "An interim api_retry message (docs/engine-baseline.md §Full verdict tally, ratelimit row).",
  limitSignal:
    "A rate_limit_event/rate_limit_info signal (docs/engine-baseline.md §8, verbatim schema).",
};
