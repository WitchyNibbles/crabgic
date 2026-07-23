import { describe, expect, it } from "vitest";
import {
  RATE_LIMIT_ALLOWED_FIVE_HOUR,
  RATE_LIMIT_ALLOWED_WARNING_96,
  RATE_LIMIT_ALLOWED_WARNING_98,
  RATE_LIMIT_ALLOWED_WARNING_99,
  RECORDED_RATE_LIMIT_PAYLOADS,
} from "@eo/testkit";
import type { SDKRateLimitEvent } from "@anthropic-ai/claude-agent-sdk";
import {
  detectLimitErrorString,
  LimitSignalNormalizationError,
  rateLimitEventToLimitSignal,
} from "./limit-signal.js";

/**
 * roadmap/06-claude-engine-adapter.md work item 2's first failing test:
 * "feed phase-00's rate-limit fixture transcript through the parser and
 * assert a typed limitSignal event" — docs/engine-baseline.md §8.
 */
function buildRateLimitEvent(
  rateLimitInfo: Record<string, unknown>,
  sessionId = "session-1",
): SDKRateLimitEvent {
  return {
    type: "rate_limit_event",
    rate_limit_info: rateLimitInfo as SDKRateLimitEvent["rate_limit_info"],
    uuid: "11111111-1111-1111-1111-111111111111",
    session_id: sessionId,
  };
}

describe("rateLimitEventToLimitSignal — baseline §8 verbatim payloads (via @eo/testkit)", () => {
  it("normalizes the 'allowed' five_hour payload", () => {
    const event = rateLimitEventToLimitSignal(
      buildRateLimitEvent(RATE_LIMIT_ALLOWED_FIVE_HOUR),
      "session-1",
    );
    expect(event).toEqual({
      type: "limitSignal",
      sessionId: "session-1",
      ...RATE_LIMIT_ALLOWED_FIVE_HOUR,
    });
  });

  it.each([
    ["0.96", RATE_LIMIT_ALLOWED_WARNING_96],
    ["0.98", RATE_LIMIT_ALLOWED_WARNING_98],
    ["0.99", RATE_LIMIT_ALLOWED_WARNING_99],
  ])("normalizes the 'allowed_warning' utilization %s payload", (_label, payload) => {
    const event = rateLimitEventToLimitSignal(buildRateLimitEvent(payload), "session-2");
    expect(event).toEqual({
      type: "limitSignal",
      sessionId: "session-2",
      ...payload,
    });
    expect(event.status).toBe("allowed_warning");
  });

  it("normalizes every recorded payload from @eo/testkit's shared fixture list", () => {
    for (const payload of RECORDED_RATE_LIMIT_PAYLOADS) {
      const event = rateLimitEventToLimitSignal(buildRateLimitEvent(payload), "s");
      expect(event).toEqual({ type: "limitSignal", sessionId: "s", ...payload });
    }
  });
});

describe("rateLimitEventToLimitSignal — hand-built 'rejected' sample (SDK-typed, unobserved live per baseline §8)", () => {
  it("normalizes a status:'rejected' payload with errorCode 'credits_required'", () => {
    const event = rateLimitEventToLimitSignal(
      buildRateLimitEvent({
        status: "rejected",
        resetsAt: 1784999999,
        rateLimitType: "five_hour",
        errorCode: "credits_required",
      }),
      "session-3",
    );
    expect(event).toEqual({
      type: "limitSignal",
      sessionId: "session-3",
      status: "rejected",
      resetsAt: 1784999999,
      rateLimitType: "five_hour",
      errorCode: "credits_required",
    });
  });
});

describe("rateLimitEventToLimitSignal — every optional field, present and valid (SDK's full SDKRateLimitInfo shape)", () => {
  it("normalizes a payload carrying every optional field, including overageResetsAt", () => {
    const event = rateLimitEventToLimitSignal(
      buildRateLimitEvent({
        status: "allowed_warning",
        resetsAt: 1784135400,
        rateLimitType: "seven_day",
        utilization: 0.5,
        surpassedThreshold: 0.4,
        overageStatus: "allowed",
        overageResetsAt: 1784200000,
        overageDisabledReason: "out_of_credits",
        isUsingOverage: true,
      }),
      "session-full",
    );
    expect(event).toEqual({
      type: "limitSignal",
      sessionId: "session-full",
      status: "allowed_warning",
      resetsAt: 1784135400,
      rateLimitType: "seven_day",
      utilization: 0.5,
      surpassedThreshold: 0.4,
      overageStatus: "allowed",
      overageResetsAt: 1784200000,
      overageDisabledReason: "out_of_credits",
      isUsingOverage: true,
    });
  });
});

describe("rateLimitEventToLimitSignal — malformed/missing rate_limit_info → typed error", () => {
  it("throws LimitSignalNormalizationError when rate_limit_info is missing", () => {
    const malformed = {
      type: "rate_limit_event",
      uuid: "u",
      session_id: "s",
    } as unknown as SDKRateLimitEvent;
    expect(() => rateLimitEventToLimitSignal(malformed, "s")).toThrow(
      LimitSignalNormalizationError,
    );
  });

  it("throws LimitSignalNormalizationError when status is not a recognized enum member", () => {
    expect(() =>
      rateLimitEventToLimitSignal(buildRateLimitEvent({ status: "throttled", resetsAt: 1 }), "s"),
    ).toThrow(LimitSignalNormalizationError);
  });

  it("throws LimitSignalNormalizationError when resetsAt is missing (required by EngineLimitSignalEvent)", () => {
    expect(() =>
      rateLimitEventToLimitSignal(buildRateLimitEvent({ status: "allowed" }), "s"),
    ).toThrow(LimitSignalNormalizationError);
  });

  it("throws LimitSignalNormalizationError when rateLimitType is outside the baseline §8 set", () => {
    expect(() =>
      rateLimitEventToLimitSignal(
        buildRateLimitEvent({ status: "allowed", resetsAt: 1, rateLimitType: "monthly" }),
        "s",
      ),
    ).toThrow(LimitSignalNormalizationError);
  });

  it("throws LimitSignalNormalizationError when utilization is present but not a number", () => {
    expect(() =>
      rateLimitEventToLimitSignal(
        buildRateLimitEvent({ status: "allowed_warning", resetsAt: 1, utilization: "high" }),
        "s",
      ),
    ).toThrow(LimitSignalNormalizationError);
  });

  it("throws LimitSignalNormalizationError when surpassedThreshold is present but not a number", () => {
    expect(() =>
      rateLimitEventToLimitSignal(
        buildRateLimitEvent({ status: "allowed_warning", resetsAt: 1, surpassedThreshold: "high" }),
        "s",
      ),
    ).toThrow(LimitSignalNormalizationError);
  });

  it("throws LimitSignalNormalizationError when overageStatus is present but not a string", () => {
    expect(() =>
      rateLimitEventToLimitSignal(
        buildRateLimitEvent({ status: "allowed", resetsAt: 1, overageStatus: 7 }),
        "s",
      ),
    ).toThrow(LimitSignalNormalizationError);
  });

  it("throws LimitSignalNormalizationError when overageResetsAt is present but not a number", () => {
    expect(() =>
      rateLimitEventToLimitSignal(
        buildRateLimitEvent({ status: "allowed", resetsAt: 1, overageResetsAt: "soon" }),
        "s",
      ),
    ).toThrow(LimitSignalNormalizationError);
  });

  it("throws LimitSignalNormalizationError when overageDisabledReason is present but not a string", () => {
    expect(() =>
      rateLimitEventToLimitSignal(
        buildRateLimitEvent({ status: "allowed", resetsAt: 1, overageDisabledReason: 7 }),
        "s",
      ),
    ).toThrow(LimitSignalNormalizationError);
  });

  it("throws LimitSignalNormalizationError when isUsingOverage is present but not a boolean", () => {
    expect(() =>
      rateLimitEventToLimitSignal(
        buildRateLimitEvent({ status: "allowed", resetsAt: 1, isUsingOverage: "yes" }),
        "s",
      ),
    ).toThrow(LimitSignalNormalizationError);
  });

  it("throws LimitSignalNormalizationError when errorCode is present but not 'credits_required'", () => {
    expect(() =>
      rateLimitEventToLimitSignal(
        buildRateLimitEvent({ status: "rejected", resetsAt: 1, errorCode: "insufficient_funds" }),
        "s",
      ),
    ).toThrow(LimitSignalNormalizationError);
  });
});

describe("detectLimitErrorString — error-string fallback channel (docs/engine-baseline.md §8 verbatim)", () => {
  const BASELINE_SAMPLE =
    "Agent terminated early due to an API error: You've hit your session limit · resets 2:10pm (Europe/Madrid)";

  it("matches the exact baseline §8 verbatim sample", () => {
    const detection = detectLimitErrorString(BASELINE_SAMPLE);
    expect(detection.matched).toBe(true);
    if (detection.matched) {
      expect(detection.rawText).toBe(BASELINE_SAMPLE);
      expect(detection.resetPhrase).toContain("resets 2:10pm (Europe/Madrid)");
    }
  });

  it("does NOT match a benign sentence merely discussing rate limiting", () => {
    const detection = detectLimitErrorString("rate limiting is a server concern");
    expect(detection.matched).toBe(false);
  });

  it("does NOT match a limit phrase with no accompanying resets phrase", () => {
    const detection = detectLimitErrorString("You've hit your session limit.");
    expect(detection.matched).toBe(false);
  });

  it("does NOT match a resets phrase with no accompanying limit phrase", () => {
    const detection = detectLimitErrorString("Your quota resets 2:10pm (Europe/Madrid)");
    expect(detection.matched).toBe(false);
  });

  it("does NOT match an unrelated error string", () => {
    const detection = detectLimitErrorString(
      "Agent terminated early due to an API error: connection reset",
    );
    expect(detection.matched).toBe(false);
  });
});
