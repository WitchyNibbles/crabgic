import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "@crabgic/contracts";
import { GATES_PASS_CRITERION, deriveGateCriteria } from "./gate-criteria.js";

/**
 * Deriving the gate-decidable exit criterion from journaled evidence, instead
 * of believing the caller.
 *
 * `review.submit` takes `metCriteria` as an input, which means an orchestrator
 * that lies about its gate results is believed — a limit recorded honestly in
 * ledger Gap 20 rather than glossed. This closes it for the one criterion a
 * tool can actually decide: `implement-gates-pass`.
 *
 * The signal is the same one the release gate scores on — a linked
 * `EvidenceRecord` reporting a nonzero `exitStatus` is a genuine negative run.
 */

function record(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    schemaVersion: 1,
    id: "11111111-1111-4111-8111-111111111111",
    changeSetId: "22222222-2222-4222-8222-222222222222",
    command: "npm run test",
    exitStatus: 0,
    toolchainFingerprint: "node24",
    capturedAt: "2026-07-29T00:00:00.000Z",
    artifactDigests: [],
    objectId: "abc123",
    gateTag: "tdd",
    ...overrides,
  } as EvidenceRecord;
}

describe("deriveGateCriteria", () => {
  it("reports the gates-pass criterion met when every gate record is a zero exit", () => {
    const met = deriveGateCriteria([record(), record({ gateTag: "coverage" })]);
    expect(met).toContain(GATES_PASS_CRITERION);
  });

  it("does NOT report it met when any gate record is a nonzero exit", () => {
    const met = deriveGateCriteria([record(), record({ gateTag: "coverage", exitStatus: 1 })]);
    expect(met).not.toContain(GATES_PASS_CRITERION);
  });

  /**
   * The case that matters most, and the one a caller-supplied boolean gets
   * wrong for free: gates that never ran are not gates that passed. An empty
   * evidence set is absence of proof, and treating it as proof of absence is
   * how a stage closes on work nobody verified.
   */
  it("does NOT report it met when NO gate has run at all", () => {
    expect(deriveGateCriteria([])).not.toContain(GATES_PASS_CRITERION);
  });

  it("ignores evidence that is not a gate firing", () => {
    // Gap 6's rendered-artifact evidence carries no gate tag and is not a gate
    // verdict; counting it would let a stage pass on evidence of the wrong kind.
    const met = deriveGateCriteria([record({ gateTag: undefined })]);
    expect(met).not.toContain(GATES_PASS_CRITERION);
  });

  it("ignores a nonzero exit on a record that is not a gate firing", () => {
    const met = deriveGateCriteria([record(), record({ gateTag: undefined, exitStatus: 1 })]);
    expect(met).toContain(GATES_PASS_CRITERION);
  });
});
