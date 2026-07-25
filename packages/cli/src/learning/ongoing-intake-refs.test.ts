import { describe, expect, it } from "vitest";
import type { ChangeSet } from "@eo/contracts";
import { buildChangeSet } from "@eo/testkit";
import {
  AmbiguousOngoingIntakeError,
  NoOngoingIntakeError,
  ONGOING_INTAKE_STATES,
  resolveOngoingIntakeRefs,
} from "./ongoing-intake-refs.js";

function changeSetsFrom(...sets: readonly ChangeSet[]): { list: () => readonly ChangeSet[] } {
  return { list: () => sets };
}

function ongoing(overrides: Partial<ChangeSet> = {}): ChangeSet {
  return buildChangeSet({ state: "running", ...overrides });
}

describe("resolveOngoingIntakeRefs", () => {
  it("takes every reference from the one in-flight ChangeSet, never inventing an id", () => {
    const changeSet = ongoing();

    const refs = resolveOngoingIntakeRefs(changeSetsFrom(changeSet));

    expect(refs).toEqual({
      intentContractId: changeSet.intentContractId,
      authorizationEnvelopeId: changeSet.authorizationEnvelopeId,
      capabilityManifestId: changeSet.capabilityManifestId,
      provisionalPerformanceContractId: changeSet.provisionalPerformanceContractId,
      integrationOrder: changeSet.integrationOrder,
    });
  });

  it("resolves from a ChangeSet in any of the in-flight states", () => {
    for (const state of ONGOING_INTAKE_STATES) {
      const changeSet = ongoing({ state });
      expect(resolveOngoingIntakeRefs(changeSetsFrom(changeSet)).intentContractId).toBe(
        changeSet.intentContractId,
      );
    }
  });

  /**
   * The whole point of the owner's ruling: a promoted lesson rides an
   * intake that is ALREADY happening. With none in flight there is nothing
   * to ride, and fabricating references would produce a ChangeSet pointing
   * at ids that resolve to nothing.
   */
  it("refuses when no intake is in flight, rather than fabricating references", () => {
    expect(() => resolveOngoingIntakeRefs(changeSetsFrom())).toThrow(NoOngoingIntakeError);
  });

  it("ignores terminal ChangeSets — a published/failed/cancelled intake is not ongoing", () => {
    const terminal = [
      ongoing({ state: "published_local" }),
      ongoing({ state: "failed" }),
      ongoing({ state: "cancelled" }),
    ];

    expect(() => resolveOngoingIntakeRefs(changeSetsFrom(...terminal))).toThrow(
      NoOngoingIntakeError,
    );
  });

  /** `draft`/`awaiting_approval` are deliberately NOT ongoing: their envelope is not approved yet, and a lesson must never ride an unapproved authorization. */
  it("refuses to ride an intake whose envelope is not yet approved", () => {
    expect(() => resolveOngoingIntakeRefs(changeSetsFrom(ongoing({ state: "draft" })))).toThrow(
      NoOngoingIntakeError,
    );
    expect(() =>
      resolveOngoingIntakeRefs(changeSetsFrom(ongoing({ state: "awaiting_approval" }))),
    ).toThrow(NoOngoingIntakeError);
  });

  /** Two concurrent intakes make "the ongoing one" ambiguous; picking either would silently attach the lesson to work the operator did not choose. */
  it("refuses when more than one intake is in flight, naming them", () => {
    const a = ongoing({ id: "11111111-1111-4111-8111-111111111111" });
    const b = ongoing({ id: "22222222-2222-4222-8222-222222222222" });

    expect(() => resolveOngoingIntakeRefs(changeSetsFrom(a, b))).toThrow(
      AmbiguousOngoingIntakeError,
    );
    expect(() => resolveOngoingIntakeRefs(changeSetsFrom(a, b))).toThrow(/11111111|22222222/);
  });
});
