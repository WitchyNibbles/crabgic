import { describe, expect, it } from "vitest";
import { NPlusOneDetector } from "./n-plus-one-detector.js";

describe("NPlusOneDetector", () => {
  it("does not flag a single batched fetch (0 child requests per parent item)", () => {
    const detector = new NPlusOneDetector();
    detector.recordParentItems(50);
    expect(detector.report().flagged).toBe(false);
  });

  it("does not flag exactly one child request per parent item (at the default threshold)", () => {
    const detector = new NPlusOneDetector();
    detector.recordParentItems(10);
    for (let i = 0; i < 10; i += 1) detector.recordChildRequest();
    expect(detector.report().flagged).toBe(false);
  });

  it("flags more than one child request per parent item (classic N+1)", () => {
    const detector = new NPlusOneDetector();
    detector.recordParentItems(10);
    for (let i = 0; i < 25; i += 1) detector.recordChildRequest();
    const report = detector.report();
    expect(report.flagged).toBe(true);
    expect(report.childRequestCount).toBe(25);
    expect(report.parentItemCount).toBe(10);
  });

  it("never flags when zero parent items were recorded", () => {
    const detector = new NPlusOneDetector();
    detector.recordChildRequest();
    detector.recordChildRequest();
    expect(detector.report().flagged).toBe(false);
  });

  it("respects a custom maxChildRequestsPerParent threshold (ratio above it flags)", () => {
    const detector = new NPlusOneDetector({ maxChildRequestsPerParent: 3 });
    detector.recordParentItems(10);
    for (let i = 0; i < 40; i += 1) detector.recordChildRequest();
    expect(detector.report().flagged).toBe(true); // ratio 4 > 3
  });

  it("does not flag when under a raised threshold", () => {
    const detector = new NPlusOneDetector({ maxChildRequestsPerParent: 5 });
    detector.recordParentItems(10);
    for (let i = 0; i < 20; i += 1) detector.recordChildRequest();
    expect(detector.report().flagged).toBe(false);
  });
});
