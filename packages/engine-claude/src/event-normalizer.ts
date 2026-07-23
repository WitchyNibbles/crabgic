/**
 * SDK `SDKMessage` stream → engine-core's typed `EngineEvent` stream
 * (roadmap/06-claude-engine-adapter.md work item 2; README decision 8).
 * `EngineEvent` is engine-core's own NORMALIZED, adapter-level taxonomy
 * over the engine's raw stream-json/SDK message types (six variants:
 * `init | assistant | toolUse | result | retry | limitSignal`) — not a
 * byte-for-byte mirror (`packages/engine-core/src/adapter/engine-event.ts`
 * doc comment).
 *
 * `SDKMessage` (sdk.d.ts 0.3.210) is a union of ~39 members. Only five are
 * mapped to a normalized event here, each grounded in a specific
 * `docs/engine-baseline.md` section:
 *   - `system`/`init` (§2, §4.4, §7)              → `init`
 *   - `assistant`                     (§2, §5)     → `assistant` and/or `toolUse`
 *   - `result`         (§3 permission_denials, §5) → `result`
 *   - `system`/`api_retry`            (§Full verdict tally; §12 WAIVED)
 *                                                   → `retry`
 *   - `rate_limit_event`              (§8)          → `limitSignal` (via
 *     `limit-signal.ts`)
 * Every other member (e.g. `system`/`status`, `system`/`thinking_tokens`,
 * `stream_event`, `user` outside tool-result pairing, and the ~30 other
 * system-notification/task/hook/plugin members) is a documented SKIP:
 * `normalizeSdkMessage` returns `undefined` for it, forward-compatibly —
 * NEVER throws merely because a member is unhandled. This matters
 * concretely: baseline §7's crash fixture
 * (`06-sessions.raw.sanitized.json`'s `kill9-initial`) and every
 * committed transcript are full of `thinking_tokens`/`status`/
 * `stream_event` frames interleaved with the handled ones.
 *
 * Tool-use/tool-result pairing (design note, per roadmap/06 work item 2's
 * instruction to "design the pairing explicitly, document it"):
 * `normalizeSdkMessage` is a PURE per-message function — one input message
 * maps to AT MOST one `EngineEvent` — so it cannot represent a completed
 * `EngineToolUseEvent` (which needs BOTH the `tool_use` content block from
 * an `assistant` message AND the paired `tool_result` content block from a
 * LATER `user` message) on its own. `normalizeSdkStream` is the stateful
 * wrapper that does this pairing: it emits a `toolUse` event with
 * `toolResult` undefined the moment a `tool_use` content block is seen,
 * caches it by `toolUseId`, and — when the matching `user`/`tool_result`
 * message later arrives — emits a SECOND `toolUse` event for the SAME
 * `toolUseId`, this time with `toolResult` populated. Consumers correlate
 * by `toolUseId` and treat the latest event bearing that id as
 * authoritative (baseline §2's committed transcript shows exactly this
 * shape: a `tool_use` assistant frame followed by a `tool_result`-bearing
 * `user` frame, e.g. `toolu_01CYZ5Gtij91ebmb37LF7Beo`). A `tool_result`
 * with no matching cached `tool_use` (a malformed/truncated stream) is
 * silently ignored, not an error — `normalizeSdkStream` must never throw
 * merely because a crash truncated the stream (baseline §7 crash shape).
 *
 * `normalizeSdkMessage`'s own per-message mapping of an `assistant` frame
 * additionally documents a narrower limitation: because it can return only
 * ONE event, if a single frame's content array carried BOTH text block(s)
 * AND `tool_use` block(s) — not observed in any baseline fixture, where
 * every captured `assistant` frame carries exactly one block of interest
 * (baseline §2's transcript: a `thinking`-only frame, then a
 * `tool_use`-only frame, then later a `thinking`-only frame, then a
 * `text`-only frame) — this pure function prioritizes the FIRST `tool_use`
 * block over any concatenated text, and drops any additional `tool_use`
 * blocks beyond the first. `normalizeSdkStream` does not share this
 * limitation: it calls the same block-extraction helper directly and
 * yields one event per block (the concatenated text, if any, THEN one
 * `toolUse` event per `tool_use` block), so it recovers full multi-block
 * coverage even in the unobserved case.
 *
 * Error-string fallback synthesis (documented per roadmap/06 work item 2's
 * instruction): `docs/engine-baseline.md` §8 records that the only
 * exhausted/`rejected`-limit sample ever actually observed arrived as
 * free text, not a structured `rate_limit_event`: "Agent terminated early
 * due to an API error: You've hit your session limit · resets 2:10pm
 * (Europe/Madrid)". `normalizeSdkStream` runs `detectLimitErrorString`
 * (`limit-signal.ts`) ONLY over ENGINE-ORIGINATED error text — a
 * non-success `result` message's own `errors` array — and, on a match,
 * SYNTHESIZES an additional `limitSignal` event with `status: "rejected"`.
 * FINDING 6 (prompt-injection resistance): the detector is DELIBERATELY NOT
 * run over model-authored, prompt-injectable text — neither `assistant`
 * message prose nor a SUCCESS result's `result` field — so a worker induced
 * to emit "you've hit your rate limit" can never synthesize a spurious
 * `rejected` limitSignal (which 13's scheduler would park/stall on). This
 * synthesized event is NOT a real `rate_limit_info` payload: there is no
 * machine-parseable epoch in a free-text "resets 2:10pm (Europe/Madrid)"
 * phrase, so `resetsAt` is set to the sentinel `0` and no
 * `rateLimitType`/`utilization`/etc. fields are populated. Callers must
 * treat a sentinel-`resetsAt` `rejected` event as this fallback channel,
 * distinct from a real structured one. Parking policy is 13's
 * (roadmap/06 §Out of scope) — this module only detects and surfaces.
 */
import type { EngineEvent, EngineLimitSignalEvent, EnginePermissionDenial } from "@eo/engine-core";
import type {
  SDKAPIRetryMessage,
  SDKAssistantMessage,
  SDKMessage,
  SDKRateLimitEvent,
  SDKResultMessage,
  SDKSystemMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { detectLimitErrorString, rateLimitEventToLimitSignal } from "./limit-signal.js";
import type { LimitSignalNormalizationError } from "./limit-signal.js";

/**
 * Thrown when a message OF A HANDLED TYPE (`system`/`init`, `assistant`,
 * `result`, `system`/`api_retry`, `rate_limit_event`) is structurally
 * invalid — a required field missing or the wrong type. Never thrown for
 * an unhandled member type (those are a documented skip, returning
 * `undefined`), and never thrown merely because an OPTIONAL field is
 * absent.
 */
export class EventNormalizationError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "EventNormalizationError";
  }
}

/** `session_id` is optional on some SDK message types (e.g. `SDKUserMessage`); falls back when absent/malformed. */
function resolveSessionId(candidate: string | undefined, fallbackSessionId: string): string {
  return typeof candidate === "string" && candidate.length > 0 ? candidate : fallbackSessionId;
}

interface ExtractedToolUse {
  readonly toolUseId: string;
  readonly toolName: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
}

interface ExtractedAssistantContent {
  /** Concatenation of every `text` content block's `text`, in array order; `undefined` if none. */
  readonly text: string | undefined;
  /** Every `tool_use` content block, in array order. */
  readonly toolUses: readonly ExtractedToolUse[];
}

/**
 * Extracts every normalizable sub-event from one `assistant` message's
 * content-block array (`BetaContentBlock[]`, per the SDK's own
 * `BetaMessage.content` type). Non-normalizable block types (`thinking`,
 * `redacted_thinking`, `server_tool_use`, etc. — baseline §2's transcript
 * shows real `thinking` blocks alongside `text`/`tool_use`) are silently
 * skipped, never an error.
 */
function extractAssistantContent(message: SDKAssistantMessage): ExtractedAssistantContent {
  const content: unknown = message.message?.content;
  if (!Array.isArray(content)) {
    throw new EventNormalizationError(
      "assistant message.message.content must be an array of content blocks",
    );
  }

  const textParts: string[] = [];
  const toolUses: ExtractedToolUse[] = [];

  for (const [index, block] of content.entries()) {
    if (
      block === null ||
      typeof block !== "object" ||
      typeof (block as { type?: unknown }).type !== "string"
    ) {
      throw new EventNormalizationError(
        `assistant content block [${String(index)}] is missing a string 'type' discriminator`,
      );
    }
    const typed = block as { readonly type: string };

    if (typed.type === "text") {
      const textBlock = block as { readonly text?: unknown };
      if (typeof textBlock.text !== "string") {
        throw new EventNormalizationError(
          `assistant content block [${String(index)}] (type 'text') is missing a string 'text' field`,
        );
      }
      textParts.push(textBlock.text);
      continue;
    }

    if (typed.type === "tool_use") {
      const toolUseBlock = block as {
        readonly id?: unknown;
        readonly name?: unknown;
        readonly input?: unknown;
      };
      if (typeof toolUseBlock.id !== "string" || typeof toolUseBlock.name !== "string") {
        throw new EventNormalizationError(
          `assistant content block [${String(index)}] (type 'tool_use') is missing a string 'id'/'name'`,
        );
      }
      const input: unknown = toolUseBlock.input;
      if (input === null || typeof input !== "object" || Array.isArray(input)) {
        throw new EventNormalizationError(
          `assistant content block [${String(index)}] (type 'tool_use') 'input' must be an object`,
        );
      }
      toolUses.push({
        toolUseId: toolUseBlock.id,
        toolName: toolUseBlock.name,
        toolInput: input as Record<string, unknown>,
      });
      continue;
    }

    // Any other content-block type (thinking, redacted_thinking, server_tool_use, ...):
    // documented skip — not normalizable into EngineEvent's taxonomy.
  }

  return { text: textParts.length > 0 ? textParts.join("") : undefined, toolUses };
}

function normalizeInit(message: SDKSystemMessage, fallbackSessionId: string): EngineEvent {
  if (typeof message.model !== "string" || typeof message.cwd !== "string") {
    throw new EventNormalizationError("system/init message.model and message.cwd must be strings");
  }
  if (!Array.isArray(message.tools) || !message.tools.every((tool) => typeof tool === "string")) {
    throw new EventNormalizationError(
      "system/init message.tools must be a string array (docs/engine-baseline.md §4.4)",
    );
  }
  if (!Array.isArray(message.mcp_servers)) {
    throw new EventNormalizationError(
      "system/init message.mcp_servers must be an array (docs/engine-baseline.md §2)",
    );
  }
  const mcpServers: string[] = [];
  for (const [index, server] of message.mcp_servers.entries()) {
    const name: unknown = (server as { readonly name?: unknown } | null)?.name;
    if (typeof name !== "string") {
      throw new EventNormalizationError(
        `system/init mcp_servers[${String(index)}].name must be a string`,
      );
    }
    mcpServers.push(name);
  }

  return {
    type: "init",
    sessionId: resolveSessionId(message.session_id, fallbackSessionId),
    model: message.model,
    cwd: message.cwd,
    tools: message.tools,
    mcpServers,
  };
}

/**
 * Pure per-message mapping for `assistant`; see this module's top-level
 * doc comment for the documented single-event-per-call limitation
 * (`toolUse` from the first `tool_use` block wins over concatenated
 * text) and why `normalizeSdkStream` does not share it.
 */
function normalizeAssistant(
  message: SDKAssistantMessage,
  fallbackSessionId: string,
): EngineEvent | undefined {
  const sessionId = resolveSessionId(message.session_id, fallbackSessionId);
  const { text, toolUses } = extractAssistantContent(message);

  const firstToolUse = toolUses[0];
  if (firstToolUse !== undefined) {
    return {
      type: "toolUse",
      sessionId,
      toolUseId: firstToolUse.toolUseId,
      toolName: firstToolUse.toolName,
      toolInput: firstToolUse.toolInput,
    };
  }

  if (text !== undefined) {
    return { type: "assistant", sessionId, text };
  }

  return undefined;
}

function normalizePermissionDenials(message: SDKResultMessage): readonly EnginePermissionDenial[] {
  if (!Array.isArray(message.permission_denials)) {
    throw new EventNormalizationError(
      "result message.permission_denials must be an array (docs/engine-baseline.md §3)",
    );
  }
  return message.permission_denials.map((denial, index) => {
    if (denial === null || typeof denial !== "object") {
      throw new EventNormalizationError(
        `result permission_denials[${String(index)}] must be an object`,
      );
    }
    const record = denial as { readonly tool_name?: unknown; readonly tool_input?: unknown };
    if (typeof record.tool_name !== "string") {
      throw new EventNormalizationError(
        `result permission_denials[${String(index)}].tool_name must be a string`,
      );
    }
    const toolInput: unknown = record.tool_input;
    if (toolInput === null || typeof toolInput !== "object" || Array.isArray(toolInput)) {
      throw new EventNormalizationError(
        `result permission_denials[${String(index)}].tool_input must be an object`,
      );
    }
    return { toolName: record.tool_name, toolInput: toolInput as Record<string, unknown> };
  });
}

function normalizeResult(message: SDKResultMessage, fallbackSessionId: string): EngineEvent {
  if (typeof message.subtype !== "string") {
    throw new EventNormalizationError("result message.subtype must be a string");
  }
  if (typeof message.is_error !== "boolean") {
    throw new EventNormalizationError("result message.is_error must be a boolean");
  }
  if (typeof message.num_turns !== "number") {
    throw new EventNormalizationError("result message.num_turns must be a number");
  }
  if (typeof message.total_cost_usd !== "number") {
    throw new EventNormalizationError("result message.total_cost_usd must be a number");
  }
  const permissionDenials = normalizePermissionDenials(message);

  // baseline §5: subtype "success" with structured_output ABSENT is a normal,
  // expected shape — normalizes to structuredOutput: undefined, not an error.
  let structuredOutput: Readonly<Record<string, unknown>> | undefined;
  if (message.subtype === "success" && message.structured_output !== undefined) {
    const raw: unknown = message.structured_output;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new EventNormalizationError(
        "result structured_output, when present, must be a plain object (docs/engine-baseline.md §5)",
      );
    }
    structuredOutput = raw as Record<string, unknown>;
  }

  return {
    type: "result",
    sessionId: resolveSessionId(message.session_id, fallbackSessionId),
    subtype: message.subtype,
    isError: message.is_error,
    ...(structuredOutput !== undefined ? { structuredOutput } : {}),
    totalCostUsd: message.total_cost_usd,
    turnsUsed: message.num_turns,
    permissionDenials,
  };
}

/**
 * `api_retry` (`SDKAPIRetryMessage`) carries per-attempt diagnostics
 * (`attempt`, `max_retries`, `retry_delay_ms`, `error_status`, `error`)
 * that `EngineRetryEvent` does not surface (engine-core's taxonomy keeps
 * only `subtype: "api_retry"`) — baseline §12 records that a genuine live
 * `api_retry` sample was never captured (WAIVED: inducing a transient
 * upstream 5xx/overload deterministically was rejected as unsafe); this
 * mapping is built from the SDK's typed shape only, per that waiver.
 */
function normalizeRetry(message: SDKAPIRetryMessage, fallbackSessionId: string): EngineEvent {
  return {
    type: "retry",
    sessionId: resolveSessionId(message.session_id, fallbackSessionId),
    subtype: "api_retry",
  };
}

/**
 * `rateLimitEventToLimitSignal` (`limit-signal.ts`) only ever throws its own
 * `LimitSignalNormalizationError` — every field-validation failure is a
 * deliberate, typed check, never an incidental runtime exception. This
 * wrapper trusts that contract (rather than branching on `instanceof`) and
 * always re-throws as this module's own `EventNormalizationError`, so every
 * handled-type failure `normalizeSdkMessage` can raise is one catchable
 * class; the original error is preserved via `cause`, never swallowed.
 */
function normalizeLimitSignal(message: SDKRateLimitEvent, fallbackSessionId: string): EngineEvent {
  const sessionId = resolveSessionId(message.session_id, fallbackSessionId);
  try {
    return rateLimitEventToLimitSignal(message, sessionId);
  } catch (error) {
    const cause = error as LimitSignalNormalizationError;
    throw new EventNormalizationError(`rate_limit_event failed to normalize: ${cause.message}`, {
      cause,
    });
  }
}

/**
 * Pure per-message mapping of one `SDKMessage` to at most one `EngineEvent`.
 * See this module's top-level doc comment for the full handled/skipped
 * taxonomy and the tool-use/tool-result pairing design (this function does
 * NOT do pairing — `toolResult` is always absent from a `toolUse` event it
 * returns; use `normalizeSdkStream` for paired results).
 *
 * @throws {EventNormalizationError} if a message of a HANDLED type
 *   (`system`/`init`, `assistant`, `result`, `system`/`api_retry`,
 *   `rate_limit_event`) is structurally invalid. Never thrown for an
 *   unhandled member type — those return `undefined`.
 */
export function normalizeSdkMessage(
  message: SDKMessage,
  fallbackSessionId: string,
): EngineEvent | undefined {
  if (message.type === "system" && message.subtype === "init") {
    return normalizeInit(message, fallbackSessionId);
  }
  if (message.type === "assistant") {
    return normalizeAssistant(message, fallbackSessionId);
  }
  if (message.type === "result") {
    return normalizeResult(message, fallbackSessionId);
  }
  if (message.type === "system" && message.subtype === "api_retry") {
    return normalizeRetry(message, fallbackSessionId);
  }
  if (message.type === "rate_limit_event") {
    return normalizeLimitSignal(message, fallbackSessionId);
  }
  // All other SDKMessage union members: documented skip, never a throw.
  return undefined;
}

/** Sentinel `resetsAt` for a synthesized error-string-channel `limitSignal` — see this module's top-level doc comment. */
const ERROR_STRING_CHANNEL_RESETS_AT_SENTINEL = 0;

function synthesizeRejectedLimitSignal(sessionId: string): EngineLimitSignalEvent {
  return {
    type: "limitSignal",
    sessionId,
    status: "rejected",
    resetsAt: ERROR_STRING_CHANNEL_RESETS_AT_SENTINEL,
  };
}

/** Extracts the tool_result content blocks' text from a `user` message, keyed by `tool_use_id`. */
function extractToolResults(content: unknown): ReadonlyMap<string, string> {
  const results = new Map<string, string>();
  if (!Array.isArray(content)) {
    return results;
  }
  for (const block of content) {
    if (block === null || typeof block !== "object") {
      continue;
    }
    const typed = block as {
      readonly type?: unknown;
      readonly tool_use_id?: unknown;
      readonly content?: unknown;
    };
    if (typed.type !== "tool_result" || typeof typed.tool_use_id !== "string") {
      continue;
    }
    results.set(typed.tool_use_id, stringifyToolResultContent(typed.content));
  }
  return results;
}

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        const text: unknown = (block as { readonly text?: unknown } | null)?.text;
        return typeof text === "string" ? text : JSON.stringify(block);
      })
      .join("");
  }
  if (content === undefined) {
    return "";
  }
  return JSON.stringify(content);
}

interface PendingToolUse {
  readonly sessionId: string;
  readonly toolName: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
}

/**
 * Stateful wrapper over `normalizeSdkMessage`: does the tool-use/tool-
 * result pairing and the error-string-fallback `limitSignal` synthesis
 * documented in this module's top-level doc comment. A stream that ends
 * with no terminating `result` message (baseline §7's crash shape,
 * `06-sessions.raw.sanitized.json`'s `kill9-initial`) simply ends — the
 * caller detects the absence of a `result` event itself; this generator
 * never synthesizes one.
 */
export async function* normalizeSdkStream(
  stream: AsyncIterable<SDKMessage>,
  fallbackSessionId: string,
): AsyncGenerator<EngineEvent> {
  const pendingToolUses = new Map<string, PendingToolUse>();

  for await (const message of stream) {
    if (message.type === "assistant") {
      const sessionId = resolveSessionId(message.session_id, fallbackSessionId);
      const { text, toolUses } = extractAssistantContent(message);

      if (text !== undefined) {
        // Finding 6: assistant prose is model-authored (prompt-injectable), so
        // the error-string fallback detector is DELIBERATELY NOT run over it —
        // a worker induced to emit "you've hit your rate limit" must not
        // synthesize a spurious limitSignal. The detector runs only over
        // engine-originated error-result text (below).
        yield { type: "assistant", sessionId, text };
      }

      for (const toolUse of toolUses) {
        pendingToolUses.set(toolUse.toolUseId, {
          sessionId,
          toolName: toolUse.toolName,
          toolInput: toolUse.toolInput,
        });
        yield {
          type: "toolUse",
          sessionId,
          toolUseId: toolUse.toolUseId,
          toolName: toolUse.toolName,
          toolInput: toolUse.toolInput,
        };
      }
      continue;
    }

    if (message.type === "user") {
      const toolResults = extractToolResults(message.message?.content);
      for (const [toolUseId, toolResult] of toolResults) {
        const pending = pendingToolUses.get(toolUseId);
        if (pending === undefined) {
          // A tool_result with no matching cached tool_use (truncated/malformed
          // stream) is silently ignored — never an error, per this module's
          // crash-tolerance design.
          continue;
        }
        pendingToolUses.delete(toolUseId);
        yield {
          type: "toolUse",
          sessionId: pending.sessionId,
          toolUseId,
          toolName: pending.toolName,
          toolInput: pending.toolInput,
          toolResult,
        };
      }
      continue;
    }

    const event = normalizeSdkMessage(message, fallbackSessionId);
    if (event !== undefined) {
      yield event;
    }

    if (message.type === "result" && message.subtype !== "success") {
      // Finding 6: the error-string fallback channel is applied ONLY to
      // ENGINE-ORIGINATED error text — a non-success result's own `errors`
      // array. It is NEVER run over model-authored text: not assistant prose
      // (above), and not a SUCCESS result's `result` field (the model's final
      // reply, equally prompt-injectable). This is the only shape an actual
      // exhaustion has been observed to surface as (baseline §8: "Agent
      // terminated early due to an API error: You've hit your session limit
      // · resets 2:10pm (Europe/Madrid)").
      const sessionId = resolveSessionId(message.session_id, fallbackSessionId);
      const candidate = Array.isArray(message.errors) ? message.errors.join("\n") : "";
      const detection = detectLimitErrorString(candidate);
      if (detection.matched) {
        yield synthesizeRejectedLimitSignal(sessionId);
      }
    }
  }
}
