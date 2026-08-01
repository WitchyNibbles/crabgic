import { describe, expect, it } from "vitest";
import { buildRequirement } from "@crabgic/testkit";
import { createRequirementsRegistry } from "./requirements-registry.js";

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
