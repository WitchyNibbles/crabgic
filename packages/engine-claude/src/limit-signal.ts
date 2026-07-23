/**
 * `limitSignal` construction (roadmap/06-claude-engine-adapter.md work item
 * 2; README decision 8). Two independent detection channels, per
 * `docs/engine-baseline.md` §8:
 *
 * 1. The structured `rate_limit_event`/`rate_limit_info` schema, captured
 *    verbatim across 16 committed transcript samples (`status: "allowed" |
 *    "allowed_warning"`; no `"rejected"` sample was ever observed live) and
 *    completed by the SDK's own `SDKRateLimitEvent`/`SDKRateLimitInfo` type
 *    declaration (`sdk.d.ts` 0.3.210) — baseline §8: "The SDK type
 *    declaration ... confirms and completes the schema." Baseline §8's own
 *    directive: "Do not synthesize a guessed shape."
 * 2. The error-string fallback channel: the only shape an ACTUAL exhaustion
 *    has been observed to surface as (baseline §8, verbatim): "Agent
 *    terminated early due to an API error: You've hit your session limit ·
 *    resets 2:10pm (Europe/Madrid)". `detectLimitErrorString` is a
 *    conservative DETECTOR only — `event-normalizer.ts`'s stream wrapper is
 *    responsible for turning a match into a synthesized event, and (Finding
 *    6) applies this detector ONLY to engine-originated error-result text,
 *    never to prompt-injectable model-authored prose; parking policy itself
 *    is 13's (roadmap/06 §Out of scope).
 */
import type { EngineLimitSignalEvent, RateLimitStatus, RateLimitType } from "@eo/engine-core";
import type { SDKRateLimitEvent } from "@anthropic-ai/claude-agent-sdk";

/**
 * Thrown when a `rate_limit_event` message's `rate_limit_info` payload does
 * not match the exact schema `docs/engine-baseline.md` §8 recorded (field
 * missing, wrong type, or an enum value outside the baseline-documented
 * set). Never thrown for a well-formed payload, however sparse — every
 * field beyond `status`/`resetsAt` is optional per both the baseline
 * samples and the SDK's own type declaration.
 */
export class LimitSignalNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitSignalNormalizationError";
  }
}

const RATE_LIMIT_STATUSES: readonly RateLimitStatus[] = ["allowed", "allowed_warning", "rejected"];

const RATE_LIMIT_TYPES: readonly RateLimitType[] = [
  "five_hour",
  "seven_day",
  "seven_day_opus",
  "seven_day_sonnet",
  "seven_day_overage_included",
  "overage",
];

function isRateLimitStatus(value: unknown): value is RateLimitStatus {
  return typeof value === "string" && (RATE_LIMIT_STATUSES as readonly string[]).includes(value);
}

function isRateLimitType(value: unknown): value is RateLimitType {
  return typeof value === "string" && (RATE_LIMIT_TYPES as readonly string[]).includes(value);
}

/**
 * Maps an SDK `rate_limit_event` message to engine-core's typed
 * `EngineLimitSignalEvent`, per the exact `rate_limit_info` schema baseline
 * §8 recorded (verbatim samples: `status`/`resetsAt`/`rateLimitType`/
 * `utilization`/`isUsingOverage`/`surpassedThreshold`/`overageStatus`/
 * `overageDisabledReason`), completed by the SDK's own `SDKRateLimitInfo`
 * declaration (`overageResetsAt`, `errorCode: "credits_required"`).
 * `resetsAt` is required on `EngineLimitSignalEvent` (engine-core's own
 * contract) even though the SDK types it as optional — baseline §8's own
 * 16 samples always carry it, so a payload missing it is treated as
 * malformed here, not silently defaulted.
 *
 * Fields the SDK's `SDKRateLimitInfo` carries but engine-core's
 * `EngineLimitSignalEvent` does not (`overageInUse`,
 * `canUserPurchaseCredits`, `hasChargeableSavedPaymentMethod`) are dropped
 * — `EngineEvent` is an adapter-level NORMALIZED taxonomy, not a
 * byte-for-byte mirror (engine-core's own `engine-event.ts` doc comment).
 *
 * @throws {LimitSignalNormalizationError} if `rate_limit_info` is missing,
 *   not an object, or any present field's type/enum-membership does not
 *   match the baseline §8 schema.
 */
export function rateLimitEventToLimitSignal(
  message: SDKRateLimitEvent,
  sessionId: string,
): EngineLimitSignalEvent {
  const info: unknown = message.rate_limit_info;
  if (info === null || info === undefined || typeof info !== "object") {
    throw new LimitSignalNormalizationError(
      "rate_limit_event message carried no rate_limit_info object (docs/engine-baseline.md §8)",
    );
  }
  const record = info as Record<string, unknown>;

  const status = record.status;
  if (!isRateLimitStatus(status)) {
    throw new LimitSignalNormalizationError(
      `rate_limit_info.status was not one of allowed|allowed_warning|rejected (got ${JSON.stringify(status)})`,
    );
  }

  const resetsAt = record.resetsAt;
  if (typeof resetsAt !== "number") {
    throw new LimitSignalNormalizationError(
      "rate_limit_info.resetsAt was missing or not a number — required by EngineLimitSignalEvent " +
        "(docs/engine-baseline.md §8: 'keying reset timing on the machine-parseable epoch resetsAt')",
    );
  }

  const rateLimitType = record.rateLimitType;
  if (rateLimitType !== undefined && !isRateLimitType(rateLimitType)) {
    throw new LimitSignalNormalizationError(
      `rate_limit_info.rateLimitType was not a recognized baseline §8 member (got ${JSON.stringify(rateLimitType)})`,
    );
  }

  const utilization = record.utilization;
  if (utilization !== undefined && typeof utilization !== "number") {
    throw new LimitSignalNormalizationError(
      "rate_limit_info.utilization, when present, must be a number",
    );
  }

  const surpassedThreshold = record.surpassedThreshold;
  if (surpassedThreshold !== undefined && typeof surpassedThreshold !== "number") {
    throw new LimitSignalNormalizationError(
      "rate_limit_info.surpassedThreshold, when present, must be a number",
    );
  }

  const overageStatus = record.overageStatus;
  if (overageStatus !== undefined && typeof overageStatus !== "string") {
    throw new LimitSignalNormalizationError(
      "rate_limit_info.overageStatus, when present, must be a string",
    );
  }

  const overageResetsAt = record.overageResetsAt;
  if (overageResetsAt !== undefined && typeof overageResetsAt !== "number") {
    throw new LimitSignalNormalizationError(
      "rate_limit_info.overageResetsAt, when present, must be a number",
    );
  }

  const overageDisabledReason = record.overageDisabledReason;
  if (overageDisabledReason !== undefined && typeof overageDisabledReason !== "string") {
    throw new LimitSignalNormalizationError(
      "rate_limit_info.overageDisabledReason, when present, must be a string",
    );
  }

  const isUsingOverage = record.isUsingOverage;
  if (isUsingOverage !== undefined && typeof isUsingOverage !== "boolean") {
    throw new LimitSignalNormalizationError(
      "rate_limit_info.isUsingOverage, when present, must be a boolean",
    );
  }

  const errorCode = record.errorCode;
  if (errorCode !== undefined && errorCode !== "credits_required") {
    throw new LimitSignalNormalizationError(
      `rate_limit_info.errorCode, when present, must be 'credits_required' (got ${JSON.stringify(errorCode)})`,
    );
  }

  return {
    type: "limitSignal",
    sessionId,
    status,
    resetsAt,
    ...(rateLimitType !== undefined ? { rateLimitType } : {}),
    ...(utilization !== undefined ? { utilization } : {}),
    ...(surpassedThreshold !== undefined ? { surpassedThreshold } : {}),
    ...(overageStatus !== undefined ? { overageStatus } : {}),
    ...(overageResetsAt !== undefined ? { overageResetsAt } : {}),
    ...(overageDisabledReason !== undefined ? { overageDisabledReason } : {}),
    ...(isUsingOverage !== undefined ? { isUsingOverage } : {}),
    ...(errorCode !== undefined ? { errorCode } : {}),
  };
}

/** A match from `detectLimitErrorString`. */
export interface LimitErrorStringMatch {
  readonly matched: true;
  /** The exact input text that matched, unmodified. */
  readonly rawText: string;
  /** The extracted "resets ..." phrase, when present (always populated when `matched` — see below). */
  readonly resetPhrase?: string;
}

/** A non-match from `detectLimitErrorString`. */
export interface LimitErrorStringNoMatch {
  readonly matched: false;
}

export type LimitErrorStringDetection = LimitErrorStringMatch | LimitErrorStringNoMatch;

/**
 * A sentence naming a limit being hit: "hit your/its/their <...> limit".
 * Matches the baseline §8 verbatim sample's "You've hit your session
 * limit" wording without over-fitting to the exact noun ("session").
 */
const LIMIT_PHRASE_PATTERN = /\bhit\s+(?:your|its|their)\b[^.]{0,40}?\blimit\b/i;

/** A "resets ..." phrase, e.g. "resets 2:10pm (Europe/Madrid)". */
const RESET_PHRASE_PATTERN = /\bresets\s+[^\n]+/i;

/**
 * Conservative detector for the error-string fallback channel
 * (`docs/engine-baseline.md` §8's verbatim, only-observed-live exhaustion
 * sample): "Agent terminated early due to an API error: You've hit your
 * session limit · resets 2:10pm (Europe/Madrid)".
 *
 * Requires BOTH a sentence naming a limit being hit ("hit your ... limit")
 * AND a "resets ..." phrase before matching — either alone is not enough,
 * so a benign sentence merely discussing rate limiting in the abstract
 * ("rate limiting is a server concern") never matches. This is a fallback
 * DETECTOR only; `event-normalizer.ts`'s stream wrapper decides what to do
 * with a match (synthesize a `limitSignal` event) and — per Finding 6 —
 * feeds it ONLY engine-originated error-result text, never prompt-injectable
 * model-authored prose; parking policy is 13's (roadmap/06 §Out of scope) —
 * this function has no side effects and makes no scheduling decision.
 */
export function detectLimitErrorString(text: string): LimitErrorStringDetection {
  if (!LIMIT_PHRASE_PATTERN.test(text)) {
    return { matched: false };
  }
  const resetMatch = RESET_PHRASE_PATTERN.exec(text);
  if (resetMatch === null) {
    return { matched: false };
  }
  return { matched: true, rawText: text, resetPhrase: resetMatch[0] };
}
