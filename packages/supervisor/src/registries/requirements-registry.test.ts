import { describe, expect, it } from "vitest";
import { buildRequirement } from "@crabgic/testkit";
import type { Requirement } from "@crabgic/contracts";
import {
  createRequirementsRegistry,
  resolveRequirements,
  resolveRequirementsStrict,
  UnresolvedRequirementError,
} from "./requirements-registry.js";
import type { Registry } from "./registry.js";

describe("createRequirementsRegistry", () => {
  it("resolves a stored requirement by id, criteria and seal intact", () => {
    const registry = createRequirementsRegistry();
    const requirement = buildRequirement();
    registry.put(requirement);

    const resolved = registry.get(requirement.id);
    expect(resolved).toStrictEqual(requirement);
    expect(resolved?.criteriaHash).toBe(requirement.criteriaHash);
  });

  it("returns undefined for an unknown id rather than throwing", () => {
    expect(
      createRequirementsRegistry().get("6c84fb90-12c4-11e1-840d-7b25c5ee775a"),
    ).toBeUndefined();
  });

  it("supports querying the subset belonging to one intent contract", () => {
    const registry = createRequirementsRegistry();
    // Explicit ids: `buildRequirement` seeds a FRESH deterministic fixture
    // context per call, so two default-built requirements share an id and the
    // second would silently replace the first.
    const mine = buildRequirement({
      id: "6c84fb90-12c4-11e1-840d-7b25c5ee775a",
      intentContractId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
    });
    const other = buildRequirement({
      id: "9f14e45f-ceea-467e-b4d3-8b5f8f5f8f5e",
      intentContractId: "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f",
    });
    registry.put(mine);
    registry.put(other);

    const found = registry.query((r) => r.intentContractId === mine.intentContractId);
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe(mine.id);
  });
});

/**
 * The COMPLETION-funnel resolver. Its whole reason to exist is refusing what
 * `resolveRequirements` drops, so every case here is about the refusal.
 *
 * WHY THE PARTIAL CASE IS THE HEADLINE. An adversarial review of PR #85
 * mutated the implementation to refuse only when EVERY declared id is missing
 * — and 399/399 tests stayed green. A unit declaring `[R1, R2]` with only R2
 * missing would then be judged against a PARTIAL bar, silently: exactly the
 * bug class this resolver exists to close, one notch smaller. The
 * `missing.length > 0` boundary needs a test that bites at `1 of 2`, not only
 * at `1 of 1`.
 */
describe("resolveRequirementsStrict — the completion funnel's fail-closed resolver", () => {
  const R1 = "6c84fb90-12c4-11e1-840d-7b25c5ee775a";
  const R2 = "9f14e45f-ceea-467e-b4d3-8b5f8f5f8f5e";
  const UNIT = "11111111-1111-4111-8111-111111111111";

  function registryWith(...ids: readonly string[]): Registry<Requirement> {
    const registry = createRequirementsRegistry();
    for (const id of ids) registry.put(buildRequirement({ id }));
    return registry;
  }

  it("resolves every declared id when all are present, preserving declaration order", () => {
    const resolved = resolveRequirementsStrict(registryWith(R1, R2), [R2, R1], UNIT);
    expect(resolved.map((r) => r.id)).toStrictEqual([R2, R1]);
  });

  it("refuses when only SOME declared ids are missing, and names only the missing one", () => {
    // The mutation that survived the original suite: refusing only when the
    // resolved set is entirely empty. Here one id resolves, so an
    // `every-id-missing` implementation returns a one-element partial bar and
    // this case fails — which is the point.
    let thrown: unknown;
    try {
      resolveRequirementsStrict(registryWith(R1), [R1, R2], UNIT);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(UnresolvedRequirementError);
    const err = thrown as UnresolvedRequirementError;
    expect(err.missingRequirementIds).toStrictEqual([R2]);
    // Only the unresolvable id is named — a refusal that listed the resolvable
    // one too would send a reader hunting for a record that is right there.
    expect(err.message).toContain(R2);
    expect(err.message).not.toContain(R1);
    expect(err.message).toContain(UNIT);
    expect(err.subjectId).toBe(UNIT);
  });

  it("names EVERY missing id when more than one is unresolvable", () => {
    let thrown: unknown;
    try {
      resolveRequirementsStrict(registryWith(), [R1, R2], UNIT);
    } catch (err) {
      thrown = err;
    }
    expect((thrown as UnresolvedRequirementError).missingRequirementIds).toStrictEqual([R1, R2]);
  });

  it("resolves an EMPTY declared set to [] without throwing — a chore unit owns no bar", () => {
    // Not a missing record. `@crabgic/scheduler`'s executor accepts an empty
    // presented set by design, and this resolver must not turn that documented
    // case into a refusal.
    expect(resolveRequirementsStrict(registryWith(), [], UNIT)).toStrictEqual([]);
  });

  it("carries no subject when none is supplied, rather than inventing one", () => {
    let thrown: unknown;
    try {
      resolveRequirementsStrict(registryWith(), [R1]);
    } catch (err) {
      thrown = err;
    }
    const err = thrown as UnresolvedRequirementError;
    expect(err.subjectId).toBeUndefined();
    expect(err.message).not.toContain("declared by");
  });

  it("is distinguishable from a plain Error by name, so a catch site can route it", () => {
    const err = new UnresolvedRequirementError([R1], UNIT);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("UnresolvedRequirementError");
  });

  /** The lenient sibling still drops — the split is the design, not an oversight. */
  it("differs from resolveRequirements, which drops the same unresolvable id silently", () => {
    const registry = registryWith(R1);
    expect(resolveRequirements(registry, [R1, R2]).map((r) => r.id)).toStrictEqual([R1]);
    expect(() => resolveRequirementsStrict(registry, [R1, R2], UNIT)).toThrow(
      UnresolvedRequirementError,
    );
  });
});
