import type { EngineLimitSignalEvent } from "@eo/engine-core";

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

/** All four verbatim recorded payloads, in the order docs/engine-baseline.md §8 lists them. */
export const RECORDED_RATE_LIMIT_PAYLOADS: readonly RateLimitEventPayload[] = [
  RATE_LIMIT_ALLOWED_FIVE_HOUR,
  RATE_LIMIT_ALLOWED_WARNING_96,
  RATE_LIMIT_ALLOWED_WARNING_98,
  RATE_LIMIT_ALLOWED_WARNING_99,
];
