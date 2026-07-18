import { describe, expect, it } from "vitest";
import {
  RATE_LIMIT_ALLOWED_FIVE_HOUR,
  RATE_LIMIT_ALLOWED_WARNING_96,
  RATE_LIMIT_ALLOWED_WARNING_98,
  RATE_LIMIT_ALLOWED_WARNING_99,
  RECORDED_RATE_LIMIT_PAYLOADS,
} from "./rate-limit-fixtures.js";

/** docs/engine-baseline.md §8 verbatim schema check — never a synthesized 'rejected' sample. */
describe("RECORDED_RATE_LIMIT_PAYLOADS", () => {
  it("has exactly the four baseline-recorded payloads, in order", () => {
    expect(RECORDED_RATE_LIMIT_PAYLOADS).toEqual([
      RATE_LIMIT_ALLOWED_FIVE_HOUR,
      RATE_LIMIT_ALLOWED_WARNING_96,
      RATE_LIMIT_ALLOWED_WARNING_98,
      RATE_LIMIT_ALLOWED_WARNING_99,
    ]);
  });

  it("no payload carries status 'rejected' (baseline §8: never synthesize the unobserved variant)", () => {
    for (const payload of RECORDED_RATE_LIMIT_PAYLOADS) {
      expect(payload.status).not.toBe("rejected");
    }
  });

  it("every payload's resetsAt matches the verbatim recorded epoch", () => {
    for (const payload of RECORDED_RATE_LIMIT_PAYLOADS) {
      expect(payload.resetsAt).toBe(1784135400);
    }
  });

  it("the allowed_warning payloads carry a monotonically distinct utilization set {0.96, 0.98, 0.99}", () => {
    const utilizations = [
      RATE_LIMIT_ALLOWED_WARNING_96,
      RATE_LIMIT_ALLOWED_WARNING_98,
      RATE_LIMIT_ALLOWED_WARNING_99,
    ].map((p) => p.utilization);
    expect(utilizations).toEqual([0.96, 0.98, 0.99]);
  });
});
