import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RATE_LIMIT_ALLOWED_FIVE_HOUR,
  RATE_LIMIT_ALLOWED_WARNING_96,
  RATE_LIMIT_ALLOWED_WARNING_98,
  RATE_LIMIT_ALLOWED_WARNING_99,
  RECORDED_RATE_LIMIT_PAYLOADS,
} from "@crabgic/testkit";
import type { SDKMessage, SDKRateLimitEvent } from "@anthropic-ai/claude-agent-sdk";
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

// ---------------------------------------------------------------------------
// The criterion's "against phase-00's CAPTURED shape" conjunct, carried by the
// suite the criterion names.
//
// roadmap/06-claude-engine-adapter.md's exit criterion reads "`limitSignal`
// fires against phase-00's captured (or an equivalently live-triggered)
// rate-limit shape — `limit-signal.test`". Everything below this block drives
// the HAND-TYPED constants in `@crabgic/testkit`, and `expect(event).toEqual({
// type, sessionId, ...payload })` is a tautology over whatever those constants
// happen to hold: it pins the normalizer's passthrough, not the recorded
// values. Measured, not assumed — the closeout pass's probe B changed the
// recorded `utilization` from `0.96` to `0.97` in
// `packages/testkit/src/fake-engine/rate-limit-fixtures.ts` and every test in
// this file stayed green. Defect record
// `06-criteria-name-suites-that-do-not-carry-them.md` records that measurement.
//
// The block below is the record's remedy option 2: read the committed phase-00
// transcripts off disk, exactly as `event-normalizer.test.ts:18` resolves them,
// and drive the criterion's subject against those BYTES. It also closes the
// loop the tautology left open — the hand-typed constants are asserted to be
// the captured payloads, so perturbing either side now reddens this file.
// ---------------------------------------------------------------------------

/** The committed phase-00 fixtures (docs/engine-baseline.md §12's fixture index). */
function fixtureUrl(name: string): URL {
  return new URL(`../../../spikes/fixtures/${name}`, import.meta.url);
}

/**
 * Every `rate_limit_event` SDK message across the four committed transcript
 * files docs/engine-baseline.md §8 counts its 16 samples over. Read from disk
 * on every run: drift in the committed evidence breaks these tests rather than
 * being absorbed by a hand-copied restatement.
 */
function capturedRateLimitEvents(): readonly SDKRateLimitEvent[] {
  const jsonlFiles = ["02-hermeticity.transcript.sanitized.jsonl"];
  const runFiles = [
    "03-permissions.transcripts.sanitized.json",
    "04-sandbox.transcripts.sanitized.json",
    "05-structured-output.transcripts.sanitized.json",
  ];
  const all: SDKMessage[] = [];
  for (const name of jsonlFiles) {
    const raw = readFileSync(fixtureUrl(name), "utf8");
    all.push(
      ...raw
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as SDKMessage),
    );
  }
  for (const name of runFiles) {
    const runs = JSON.parse(readFileSync(fixtureUrl(name), "utf8")) as Record<
      string,
      readonly SDKMessage[]
    >;
    for (const run of Object.values(runs)) {
      all.push(...run);
    }
  }
  return all.filter((m): m is SDKRateLimitEvent => m.type === "rate_limit_event");
}

/** The distinct `rate_limit_info` payloads among the captured samples, first-seen order. */
function capturedDistinctPayloads(): readonly Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const event of capturedRateLimitEvents()) {
    const info = event.rate_limit_info as unknown as Record<string, unknown>;
    const key = JSON.stringify(Object.entries(info).sort(([a], [b]) => a.localeCompare(b)));
    if (!byKey.has(key)) {
      byKey.set(key, info);
    }
  }
  return [...byKey.values()];
}

describe("rateLimitEventToLimitSignal — phase-00's CAPTURED rate-limit shape, read off disk", () => {
  it("fires on every one of the 16 committed rate_limit_event samples", () => {
    const captured = capturedRateLimitEvents();
    // Anti-vacuity floor: a broken fixture path would yield zero samples and
    // the loop below would certify nothing. docs/engine-baseline.md §8's own
    // count is 16.
    expect(captured).toHaveLength(16);
    for (const event of captured) {
      const signal = rateLimitEventToLimitSignal(event, "fallback-session");
      expect(signal.type).toBe("limitSignal");
      expect(signal.sessionId).toBe("fallback-session");
      expect(signal.resetsAt).toBe(1784135400);
    }
  });

  it("the hand-typed @crabgic/testkit constants ARE the captured payloads, member for member", () => {
    // What the tautology above could not catch: these constants are what the
    // fake engine replays, and nothing tied them to the bytes phase 00
    // captured. Perturb either side — the constant or the fixture — and this
    // reddens. (Probe B in the closeout record mutated 0.96 -> 0.97 and
    // nothing in this file moved; that is what this case exists to fix.)
    const captured = capturedDistinctPayloads();
    // Equal cardinality plus one-way containment IS set equality here, because
    // `capturedDistinctPayloads` de-duplicates and the four constants are
    // pairwise distinct (pinned separately at rate-limit-fixtures.test.ts).
    expect(captured).toHaveLength(RECORDED_RATE_LIMIT_PAYLOADS.length);
    for (const payload of RECORDED_RATE_LIMIT_PAYLOADS) {
      expect(captured).toContainEqual(payload);
    }
  });

  it("normalizing a captured sample and its hand-typed twin yields the identical limitSignal", () => {
    // The criterion's verb is "fires against". This drives the SAME function
    // over both sources and requires agreement, so the constants cannot drift
    // into a shape the normalizer treats differently from the captured one.
    const capturedByUtilization = new Map<unknown, SDKRateLimitEvent>();
    for (const event of capturedRateLimitEvents()) {
      const info = event.rate_limit_info as unknown as Record<string, unknown>;
      capturedByUtilization.set(info["utilization"], event);
    }
    for (const payload of RECORDED_RATE_LIMIT_PAYLOADS) {
      const twin = capturedByUtilization.get(payload.utilization);
      expect(
        twin,
        `no captured sample with utilization ${String(payload.utilization)}`,
      ).toBeDefined();
      expect(rateLimitEventToLimitSignal(twin as SDKRateLimitEvent, "s")).toEqual(
        rateLimitEventToLimitSignal(buildRateLimitEvent(payload as Record<string, unknown>), "s"),
      );
    }
  });
});

describe("rateLimitEventToLimitSignal — baseline §8 verbatim payloads (via @crabgic/testkit)", () => {
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

  it("normalizes every recorded payload from @crabgic/testkit's shared fixture list", () => {
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
