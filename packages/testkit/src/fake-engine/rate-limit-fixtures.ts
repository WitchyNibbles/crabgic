import type { EngineLimitSignalEvent } from "@crabgic/engine-core";

/**
 * Verbatim recorded `rate_limit_info` payloads — docs/engine-baseline.md
 * §8: "16 `rate_limit_event` message(s) found in this phase's own
 * committed fixtures ... Distinct rate_limit_info payloads, verbatim."
 * Baseline §8's own directive: "Do not synthesize a guessed shape; the
 * fake engine (phase 03) replays these committed payloads." No `rejected`
 * variant is included — baseline §8 records that status as UNRESOLVED/
 * never observed live; synthesizing one here would violate the same
 * directive this module exists to honor.
 */
export type RateLimitEventPayload = Omit<EngineLimitSignalEvent, "type" | "sessionId">;

export const RATE_LIMIT_ALLOWED_FIVE_HOUR: RateLimitEventPayload = {
  status: "allowed",
  resetsAt: 1784135400,
  rateLimitType: "five_hour",
  overageStatus: "rejected",
  overageDisabledReason: "org_level_disabled",
  isUsingOverage: false,
};

export const RATE_LIMIT_ALLOWED_WARNING_96: RateLimitEventPayload = {
  status: "allowed_warning",
  resetsAt: 1784135400,
  rateLimitType: "five_hour",
  utilization: 0.96,
  isUsingOverage: false,
  surpassedThreshold: 0.9,
};

export const RATE_LIMIT_ALLOWED_WARNING_98: RateLimitEventPayload = {
  status: "allowed_warning",
  resetsAt: 1784135400,
  rateLimitType: "five_hour",
  utilization: 0.98,
  isUsingOverage: false,
  surpassedThreshold: 0.9,
};

export const RATE_LIMIT_ALLOWED_WARNING_99: RateLimitEventPayload = {
  status: "allowed_warning",
  resetsAt: 1784135400,
  rateLimitType: "five_hour",
  utilization: 0.99,
  isUsingOverage: false,
  surpassedThreshold: 0.9,
};

/**
 * ⚠️ NOT A RECORDED SAMPLE — derived from the SDK's TYPE DECLARATION, and the
 * one payload in this file that is.
 *
 * `docs/engine-baseline.md` §8 records the `rejected` variant as UNRESOLVED:
 * never captured live on either baseline pass, because deliberately exhausting
 * the owner's subscription is refused. §8 rules on that gap explicitly — phase
 * 13 "must treat the `'rejected'`-transition handling as built on the SDK's
 * _typed_ promise, exercised only against fake-engine fixtures" — which is
 * exactly what this is for, and why it is kept OUT of
 * `RECORDED_RATE_LIMIT_PAYLOADS` below. That array means "verbatim observed",
 * and this must never be allowed to dilute it.
 *
 * It exists because the alternative was worse. Until 2026-08-16 every park test
 * staged its park with an `allowed_warning` payload, which made the whole suite
 * agree that routine telemetry parks a worker — the defect that stopped any
 * work unit from ever completing. Testing the park path needs a payload that
 * genuinely refuses, and the SDK declares exactly what one looks like.
 *
 * Field set mirrors `RATE_LIMIT_ALLOWED_FIVE_HOUR`, an observed sample, with
 * only `status` changed: nothing here is invented beyond the enum value
 * `sdk.d.ts` 0.3.218 declares.
 */
export const RATE_LIMIT_REJECTED: RateLimitEventPayload = {
  status: "rejected",
  resetsAt: 1784135400,
  rateLimitType: "five_hour",
  isUsingOverage: false,
};

/** All four verbatim recorded payloads, in the order docs/engine-baseline.md §8 lists them. */
export const RECORDED_RATE_LIMIT_PAYLOADS: readonly RateLimitEventPayload[] = [
  RATE_LIMIT_ALLOWED_FIVE_HOUR,
  RATE_LIMIT_ALLOWED_WARNING_96,
  RATE_LIMIT_ALLOWED_WARNING_98,
  RATE_LIMIT_ALLOWED_WARNING_99,
];
