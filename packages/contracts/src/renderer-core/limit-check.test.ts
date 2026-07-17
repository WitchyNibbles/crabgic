import { describe, expect, it } from "vitest";
import { checkLimit } from "./limit-check.js";
import { countChars } from "./length-counter.js";
import { countLines } from "./line-counter.js";
import { COMMUNICATION_POLICY_LIMITS } from "../contracts/communication-policy.js";

describe("checkLimit", () => {
  it("accepts text within maxChars", () => {
    expect(checkLimit("a".repeat(10), { maxChars: 10 })).toBe(true);
  });

  it("rejects text over maxChars", () => {
    expect(checkLimit("a".repeat(11), { maxChars: 10 })).toBe(false);
  });

  it("accepts text within maxLines", () => {
    expect(checkLimit("a\nb", { maxLines: 2 })).toBe(true);
  });

  it("rejects text over maxLines", () => {
    expect(checkLimit("a\nb\nc", { maxLines: 2 })).toBe(false);
  });

  it("ignores a bound that is not present on the limit", () => {
    expect(checkLimit("a".repeat(1000), { maxLines: 1 })).toBe(true);
  });

  it("fails if either present bound is violated", () => {
    expect(checkLimit("a\nb", { maxChars: 1, maxLines: 5 })).toBe(false);
  });

  describe("boundary fixtures (roadmap/02 Test plan): 72-char commit subject accepted / 73-char rejected", () => {
    const prefix = "fix(contracts): ";
    const subject72 = prefix + "a".repeat(72 - prefix.length);

    it("the fixture is exactly 72 chars", () => {
      expect(countChars(subject72)).toBe(72);
    });

    it("accepts a 72-char commit subject", () => {
      expect(checkLimit(subject72, COMMUNICATION_POLICY_LIMITS.commitSubject)).toBe(true);
    });

    it("rejects a 73-char commit subject", () => {
      const subject73 = `${subject72}x`;
      expect(countChars(subject73)).toBe(73);
      expect(checkLimit(subject73, COMMUNICATION_POLICY_LIMITS.commitSubject)).toBe(false);
    });
  });

  describe("boundary fixtures (roadmap/02 Test plan): 6-line review comment accepted / 7-line rejected", () => {
    const reviewComment6 = ["l1", "l2", "l3", "l4", "l5", "l6"].join("\n");
    const reviewComment7 = ["l1", "l2", "l3", "l4", "l5", "l6", "l7"].join("\n");

    it("accepts a 6-line review comment", () => {
      expect(countLines(reviewComment6)).toBe(6);
      expect(checkLimit(reviewComment6, COMMUNICATION_POLICY_LIMITS.reviewComment)).toBe(true);
    });

    it("rejects a 7-line review comment", () => {
      expect(countLines(reviewComment7)).toBe(7);
      expect(checkLimit(reviewComment7, COMMUNICATION_POLICY_LIMITS.reviewComment)).toBe(false);
    });
  });
});
