import { describe, expect, it } from "vitest";
import { MANAGER_STOP_CONDITIONS } from "@crabgic/plugin";
import { STOP_CONDITION_KINDS } from "@crabgic/supervisor";

/**
 * Cross-package drift guard.
 *
 * `@crabgic/plugin`'s manager protocol tells the manager session which
 * conditions may halt a run; `@crabgic/supervisor` owns the enum the
 * supervisor can actually raise. If those two lists drift, the protocol
 * starts describing a machine that no longer exists — a manager could sit
 * waiting for a condition that can never fire, or fail to recognize one that
 * does.
 *
 * This test lives in `packages/cli` on purpose: it is the one package that
 * ALREADY depends on both, so the parity can be asserted without giving
 * `@crabgic/plugin` a runtime dependency on the supervisor (and without
 * adding an edge to the graph `scripts/check-package-graph-acyclic.mjs`
 * guards).
 */
describe("manager protocol / supervisor stop-condition parity", () => {
  it("covers every kind the supervisor can raise, and invents none", () => {
    const protocolKinds = [...MANAGER_STOP_CONDITIONS.map((c) => c.kind)].sort();
    const supervisorKinds = [...STOP_CONDITION_KINDS].sort();
    expect(protocolKinds).toEqual(supervisorKinds);
  });

  it("preserves the supervisor's declared order, which is the order the block renders in", () => {
    expect(MANAGER_STOP_CONDITIONS.map((c) => c.kind)).toEqual([...STOP_CONDITION_KINDS]);
  });

  it("still names exactly seven — roadmap/11's count is load-bearing prose in the docs", () => {
    expect(STOP_CONDITION_KINDS).toHaveLength(7);
    expect(MANAGER_STOP_CONDITIONS).toHaveLength(7);
  });
});
