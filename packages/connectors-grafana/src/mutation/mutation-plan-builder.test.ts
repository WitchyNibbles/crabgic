import { describe, expect, it } from "vitest";
import { buildGrafanaMutationPlan } from "./mutation-plan-builder.js";

const BASE = {
  id: "11111111-1111-4111-8111-111111111111",
  externalConnectionId: "22222222-2222-4222-8222-222222222222",
  tenant: "tenant-a",
  envelopeId: "33333333-3333-4333-8333-333333333333",
  idempotencyKey: "op-1",
  redactedDiff: "name: (new) -> on-call",
};

describe("buildGrafanaMutationPlan", () => {
  it("attaches requiredCapabilityFlags for a high-impact kind (contact-point)", () => {
    const plan = buildGrafanaMutationPlan({
      ...BASE,
      kind: "contact-point",
      action: "create",
      canonicalId: "cp-new-uid",
      input: { name: "on-call", type: "email" },
    });
    expect(plan.requiredCapabilityFlags).toEqual(["contact points"]);
    expect(plan.canonicalTarget).toBe("contact-point:cp-new-uid");
    expect(plan.impactClass).toBe("irreversible-create-no-auto-delete");
    expect(plan.rollbackClass).toBe("cleanup-report-only");
  });

  it("omits requiredCapabilityFlags entirely for a non-high-impact kind (folder)", () => {
    const plan = buildGrafanaMutationPlan({
      ...BASE,
      kind: "folder",
      action: "create",
      canonicalId: "fold-new-uid",
      input: { title: "Team Dashboards" },
    });
    expect(plan.requiredCapabilityFlags).toBeUndefined();
  });

  it("an update carries expectedRemoteRevision and the version-checked-restore rollback class", () => {
    const plan = buildGrafanaMutationPlan({
      ...BASE,
      kind: "folder",
      action: "update",
      canonicalId: "fold-1",
      input: { title: "Renamed" },
      expectedRemoteRevision: "etag-1",
    });
    expect(plan.expectedRemoteRevision).toBe("etag-1");
    expect(plan.rollbackClass).toBe("version-checked-restore");
    expect(plan.impactClass).toBe("reversible");
  });

  it("desiredStateHash is deterministic for identical input and differs for different input", () => {
    const planA = buildGrafanaMutationPlan({
      ...BASE,
      kind: "folder",
      action: "create",
      canonicalId: "fold-1",
      input: { title: "A" },
    });
    const planA2 = buildGrafanaMutationPlan({
      ...BASE,
      kind: "folder",
      action: "create",
      canonicalId: "fold-1",
      input: { title: "A" },
    });
    const planB = buildGrafanaMutationPlan({
      ...BASE,
      kind: "folder",
      action: "create",
      canonicalId: "fold-1",
      input: { title: "B" },
    });
    expect(planA.desiredStateHash).toBe(planA2.desiredStateHash);
    expect(planA.desiredStateHash).not.toBe(planB.desiredStateHash);
  });

  it("round-trips through RemoteMutationPlanSchema (validated at construction, defense in depth)", () => {
    expect(() =>
      buildGrafanaMutationPlan({
        ...BASE,
        kind: "alert-rule",
        action: "update",
        canonicalId: "rule-1",
        input: { isPaused: true },
        expectedRemoteRevision: "3",
      }),
    ).not.toThrow();
  });
});
