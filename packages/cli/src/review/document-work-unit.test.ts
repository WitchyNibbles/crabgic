import { describe, expect, it } from "vitest";
import { WorkUnitSchema } from "@crabgic/contracts";
import { buildDocumentationWorkUnit } from "./document-work-unit.js";

/**
 * The documentation stage's dispatch hop — roadmap/25 WI 8, the half that was
 * missing.
 *
 * `DocumentationRecord` gave the stage criteria and `eo-documenter` gave it a
 * planner, but nothing created a WORK UNIT — so the guides had a plan, a
 * reviewer and a set of exit criteria, and no envelope-bounded worker to write
 * them. A stage whose artifact nothing produces is a stage that cannot close.
 *
 * This is the piece that hands the guides to the same dispatch path every other
 * write in this product goes through (§0 amendment 3: always workers, never the
 * manager).
 */

const CHANGE_SET = "22222222-2222-4222-8222-222222222222";

const plan = {
  changeSetId: CHANGE_SET,
  intentContractId: "33333333-3333-4333-8333-333333333333",
  userGuidePath: "docs/user-guide.md",
  maintenanceGuidePath: "docs/maintenance-guide.md",
  commands: ["crabgic run", "crabgic status"],
  failureModes: ["gateway-unreachable"],
};

describe("buildDocumentationWorkUnit", () => {
  it("produces a schema-valid WorkUnit", () => {
    expect(WorkUnitSchema.safeParse(buildDocumentationWorkUnit(plan).workUnit).success).toBe(true);
  });

  it("owns exactly the two guide paths, and nothing else", () => {
    // The write ownership IS the containment check the envelope performs. A
    // documentation unit that owned a source tree would be a documentation
    // worker able to edit the product it is describing.
    expect(buildDocumentationWorkUnit(plan).workUnit.ownedPaths).toEqual([
      "docs/user-guide.md",
      "docs/maintenance-guide.md",
    ]);
  });

  it("REFUSES a plan whose two guides are the same file", () => {
    // One file cannot be both guides. Allowing it would let the stage close
    // with the maintenance guide silently absent -- which is the guide that
    // always goes missing and the reason the record requires both.
    expect(() =>
      buildDocumentationWorkUnit({ ...plan, maintenanceGuidePath: "docs/user-guide.md" }),
    ).toThrow(/same file/i);
  });

  it("REFUSES a plan that documents no commands and no failure modes", () => {
    // Both coverage criteria derive from a non-empty surface. A unit dispatched
    // with nothing to cover would produce a guide that satisfies its criteria
    // vacuously -- the failure this package has guarded against at six other
    // criteria.
    expect(() => buildDocumentationWorkUnit({ ...plan, commands: [], failureModes: [] })).toThrow(
      /nothing to document/i,
    );
  });

  it("carries the documentation criteria as the worker's acceptance criteria", () => {
    // The worker must be told what it is being judged against. `document-claims-
    // resolve` is the one it can fail without noticing, so it is stated.
    const criteria = buildDocumentationWorkUnit(plan).requirement.acceptanceCriteria.join(" ");
    expect(criteria).toMatch(/crabgic run/);
    expect(criteria).toMatch(/gateway-unreachable/);
    expect(criteria).toMatch(/exist/i);
  });

  it("names every command and failure mode the surface declares", () => {
    // Coverage is checked against the SERVER's surface, so a unit that dropped
    // one would dispatch a worker that cannot close the stage it was sent to.
    const criteria = buildDocumentationWorkUnit({
      ...plan,
      commands: ["a", "b", "c"],
      failureModes: ["x", "y"],
    }).requirement.acceptanceCriteria.join(" ");
    for (const token of ["a", "b", "c", "x", "y"]) expect(criteria).toContain(token);
  });

  it("maps to exactly one requirement, and the unit names it", () => {
    // The unit's `requirementIds` is what `run-dispatcher` resolves through the
    // strict registry to copy the criteria onto the packet. A unit naming a
    // requirement the caller never registers is refused there, by design.
    const { workUnit, requirement } = buildDocumentationWorkUnit(plan);
    expect(workUnit.requirementIds).toEqual([requirement.id]);
  });

  it("computes the criteria hash rather than accepting one", () => {
    // Phase 24's seal recomputes this and fails closed on a mismatch, so a
    // hand-written hash is one that will be caught rather than believed.
    const { requirement } = buildDocumentationWorkUnit(plan);
    expect(requirement.criteriaHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic given the same plan and id source", () => {
    // A unit whose id changed per call would create a new DAG node on every
    // retry, and the repair budget counts attempts per unit.
    const ids = ["11111111-1111-4111-8111-111111111111"];
    const at = new Date("2026-08-15T00:00:00.000Z");
    const once = buildDocumentationWorkUnit(plan, () => ids[0] as string, at);
    const twice = buildDocumentationWorkUnit(plan, () => ids[0] as string, at);
    expect(once).toEqual(twice);
  });
});
