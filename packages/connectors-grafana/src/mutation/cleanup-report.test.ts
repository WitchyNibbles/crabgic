import { describe, expect, it } from "vitest";
import { buildGrafanaMutationPlan } from "./mutation-plan-builder.js";
import { buildCleanupReportForFailedCreate } from "./cleanup-report.js";

const BASE = {
  id: "00000000-0000-4000-8000-000000000201",
  externalConnectionId: "00000000-0000-4000-8000-000000000202",
  tenant: "tenant-a",
  envelopeId: "00000000-0000-4000-8000-000000000203",
  idempotencyKey: "op-1",
  redactedDiff: "folder: (new) -> Team",
};

describe("buildCleanupReportForFailedCreate — exit criterion: failed creation is reported for reviewed cleanup, never auto-deleted", () => {
  it("produces a report for a failed create", () => {
    const plan = buildGrafanaMutationPlan({
      ...BASE,
      kind: "folder",
      action: "create",
      canonicalId: "uid-1",
      input: { title: "x" },
    });
    const report = buildCleanupReportForFailedCreate(
      plan,
      { status: "failed", errorKind: "conflict", detail: "verification mismatch" },
      () => new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(report).toEqual({
      planId: plan.id,
      kind: "folder",
      canonicalTarget: plan.canonicalTarget,
      reason: "verification mismatch",
      detectedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("produces a report for a blocked create (ambiguous_write)", () => {
    const plan = buildGrafanaMutationPlan({
      ...BASE,
      kind: "dashboard",
      action: "create",
      canonicalId: "uid-2",
      input: { title: "x" },
    });
    const report = buildCleanupReportForFailedCreate(plan, {
      status: "blocked",
      errorKind: "ambiguous_write",
    });
    expect(report).toBeDefined();
    expect(report?.kind).toBe("dashboard");
  });

  it("returns undefined for a successfully recorded create (nothing to clean up)", () => {
    const plan = buildGrafanaMutationPlan({
      ...BASE,
      kind: "folder",
      action: "create",
      canonicalId: "uid-3",
      input: { title: "x" },
    });
    expect(
      buildCleanupReportForFailedCreate(plan, { status: "recorded", appliedRevision: "1" }),
    ).toBeUndefined();
  });

  it("returns undefined for a replayed create", () => {
    const plan = buildGrafanaMutationPlan({
      ...BASE,
      kind: "folder",
      action: "create",
      canonicalId: "uid-4",
      input: { title: "x" },
    });
    expect(
      buildCleanupReportForFailedCreate(plan, { status: "replayed", appliedRevision: "1" }),
    ).toBeUndefined();
  });

  it("returns undefined for a failed UPDATE (cleanup-report is create-specific; updates roll back instead — see ./rollback.js)", () => {
    const plan = buildGrafanaMutationPlan({
      ...BASE,
      kind: "folder",
      action: "update",
      canonicalId: "fold-1",
      input: { title: "x" },
      expectedRemoteRevision: "etag-1",
    });
    expect(
      buildCleanupReportForFailedCreate(plan, { status: "failed", errorKind: "conflict" }),
    ).toBeUndefined();
  });
});
