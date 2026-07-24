import { describe, expect, it } from "vitest";
import { buildTaskPacket } from "@eo/testkit";
import { assertNoTargetDrift, TargetDriftError } from "./targetDrift.js";

describe("assertNoTargetDrift", () => {
  it("passes silently when a repair packet carries the identical baseObjectId as the original", () => {
    const workUnitId = "11111111-1111-4111-8111-111111111111";
    const original = buildTaskPacket({ workUnitId, baseObjectId: "a".repeat(40) });
    const repair = buildTaskPacket({ workUnitId, baseObjectId: "a".repeat(40) });
    expect(() => assertNoTargetDrift(original, repair)).not.toThrow();
  });

  it("throws TargetDriftError when a repair packet's baseObjectId has moved", () => {
    const workUnitId = "22222222-2222-4222-8222-222222222222";
    const original = buildTaskPacket({ workUnitId, baseObjectId: "a".repeat(40) });
    const drifted = buildTaskPacket({ workUnitId, baseObjectId: "b".repeat(40) });

    let caught: unknown;
    try {
      assertNoTargetDrift(original, drifted);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TargetDriftError);
    expect((caught as TargetDriftError).workUnitId).toBe(workUnitId);
    expect((caught as TargetDriftError).expectedBaseObjectId).toBe("a".repeat(40));
    expect((caught as TargetDriftError).actualBaseObjectId).toBe("b".repeat(40));
  });

  it("throws a plain Error (not TargetDriftError) when the two packets belong to different work units", () => {
    const original = buildTaskPacket({ workUnitId: "33333333-3333-4333-8333-333333333333" });
    const other = buildTaskPacket({ workUnitId: "44444444-4444-4444-8444-444444444444" });
    expect(() => assertNoTargetDrift(original, other)).toThrow(/two different work units/);
    expect(() => assertNoTargetDrift(original, other)).not.toThrow(TargetDriftError);
  });
});
