import { describe, expect, it } from "vitest";
import { EvidenceRecordSchema, isNegativeEvidence } from "./evidence-record.js";

const ID = "11111111-1111-4111-8111-111111111111";
const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const REQUIREMENT_ID = "33333333-3333-4333-8333-333333333333";
const WORK_UNIT_ID = "44444444-4444-4444-8444-444444444444";

function validEvidenceRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: ID,
    changeSetId: CHANGE_SET_ID,
    command: "npm run test:coverage",
    exitStatus: 0,
    toolchainFingerprint: "node-24.1.0+npm-11.0.0",
    capturedAt: "2026-07-15T12:00:00.000Z",
    artifactDigests: ["sha256:abcd1234"],
    objectId: "a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d",
    ...overrides,
  };
}

describe("EvidenceRecordSchema", () => {
  it("parses a fully-valid minimal fixture (no requirementId/workUnitId/gateTag)", () => {
    const result = EvidenceRecordSchema.safeParse(validEvidenceRecord());
    expect(result.success).toBe(true);
  });

  it("parses a fully-valid fixture with every optional field present", () => {
    const result = EvidenceRecordSchema.safeParse(
      validEvidenceRecord({
        requirementId: REQUIREMENT_ID,
        workUnitId: WORK_UNIT_ID,
        gateTag: "tdd",
      }),
    );
    expect(result.success).toBe(true);
  });

  /**
   * `gateVerdict` — the gate's own pass/fail judgement, which this record used
   * to lose.
   *
   * `exitStatus` was serving as the proxy for it, and for one shipped gate the
   * two genuinely disagree: the TDD gate returns `passed: false` while
   * reporting the candidate's own `exitStatus: 0` when no red baseline exists.
   * A consumer reading `exitStatus === 0` as "the gate passed" therefore reads a
   * FAILED gate as passing, which is the wrong direction for a field the
   * release gate and the review pipeline both score on.
   */
  it("parses a fixture carrying the gate's own verdict", () => {
    for (const gateVerdict of ["passed", "failed"]) {
      const result = EvidenceRecordSchema.safeParse(
        validEvidenceRecord({ gateTag: "tdd", gateVerdict }),
      );
      expect(result.success).toBe(true);
    }
  });

  /**
   * Absent is meaningful and must stay legal: a red baseline is a pre-dispatch
   * capture rather than a gate firing, and Gap 6's rendered-artifact evidence is
   * not a firing either. Neither has a verdict to report, and inventing one for
   * them is how a schema stops meaning anything.
   */
  it("parses a fixture with no gateVerdict at all", () => {
    const result = EvidenceRecordSchema.safeParse(validEvidenceRecord({ gateTag: "tdd" }));
    expect(result.success).toBe(true);
  });

  it("rejects a gateVerdict outside the two-member vocabulary", () => {
    const result = EvidenceRecordSchema.safeParse(
      validEvidenceRecord({ gateTag: "tdd", gateVerdict: "unstable" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an invalid-shape fixture (missing required command)", () => {
    const fixture = validEvidenceRecord();
    delete fixture.command;
    const result = EvidenceRecordSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it("rejects a negative exitStatus", () => {
    const result = EvidenceRecordSchema.safeParse(validEvidenceRecord({ exitStatus: -1 }));
    expect(result.success).toBe(false);
  });

  it("rejects an empty artifactDigests entry (must be non-empty strings)", () => {
    const result = EvidenceRecordSchema.safeParse(validEvidenceRecord({ artifactDigests: [""] }));
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key (.strict())", () => {
    const result = EvidenceRecordSchema.safeParse({
      ...validEvidenceRecord(),
      unexpectedField: "nope",
    });
    expect(result.success).toBe(false);
  });

  it("round-trips through JSON.stringify/JSON.parse deep-equal", () => {
    const original = EvidenceRecordSchema.parse(
      validEvidenceRecord({
        requirementId: REQUIREMENT_ID,
        workUnitId: WORK_UNIT_ID,
        gateTag: "coverage",
      }),
    );
    const revived = EvidenceRecordSchema.parse(JSON.parse(JSON.stringify(original)) as unknown);
    expect(revived).toEqual(original);
  });
});

/**
 * `isNegativeEvidence` — one canonical answer to "was this a genuine negative
 * run", for the consumers that already asked it in their own words.
 *
 * Three call sites had written `exitStatus !== 0` inline. That reading is wrong
 * for a firing whose handler failed while its command exited zero, and the
 * comments explaining it asserted — accurately, at the time — that
 * `EvidenceRecord` had no recorded verdict to consult. It does now, so the
 * question gets one implementation rather than three that must agree.
 */
describe("isNegativeEvidence", () => {
  it("believes the recorded verdict over the exit status", () => {
    expect(
      isNegativeEvidence(
        EvidenceRecordSchema.parse(
          validEvidenceRecord({ gateTag: "tdd", gateVerdict: "failed", exitStatus: 0 }),
        ),
      ),
    ).toBe(true);
  });

  it("treats a recorded pass as positive even at a nonzero exit", () => {
    // No gate shipped today reports this combination — the flake gate keeps its
    // `passed` and `exitStatus` in step even for a rerun-then-pass. It is
    // asserted anyway because the field's whole purpose is that the handler's
    // judgement outranks the exit status, and a helper that only honoured that
    // in one direction would be believing the exit status again by omission.
    expect(
      isNegativeEvidence(
        EvidenceRecordSchema.parse(
          validEvidenceRecord({ gateTag: "flake", gateVerdict: "passed", exitStatus: 1 }),
        ),
      ),
    ).toBe(false);
  });

  /**
   * Falls back to the exit status when no verdict was recorded, which keeps
   * every record journaled before the field existed scoring exactly as it did.
   * A record with no verdict is also not necessarily a firing at all, so the
   * exit status is the only thing there is to read.
   */
  it("falls back to the exit status when no verdict was recorded", () => {
    expect(
      isNegativeEvidence(EvidenceRecordSchema.parse(validEvidenceRecord({ exitStatus: 1 }))),
    ).toBe(true);
    expect(
      isNegativeEvidence(EvidenceRecordSchema.parse(validEvidenceRecord({ exitStatus: 0 }))),
    ).toBe(false);
  });
});
