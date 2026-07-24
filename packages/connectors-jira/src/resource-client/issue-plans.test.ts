import { describe, expect, it } from "vitest";
import { ConnectorError } from "@eo/contracts";
import type { JiraPlanBuildContext } from "./plan-builder.js";
import { JiraPlanPayloadRegistry } from "./plan-payload-registry.js";
import { planIssueTransition } from "./issue-plans.js";

/**
 * MAJOR-2 fix (adversarial-validation round): `planIssueTransition`'s
 * done-transition guard must be able to derive its evidence boolean from
 * `../evidence/done-transition-verification.ts`'s `hasExactRevisionVerification`
 * (21's real pointer-lookup result), not ONLY from a caller-hand-passed
 * `hasVerificationEvidence` boolean. This is an ADDITIVE, default-
 * preserving change — a caller supplying NEITHER the boolean NOR a
 * resolver keeps the exact pre-existing behavior (refuse a done transition
 * with no evidence).
 */

function planCtx(): JiraPlanBuildContext {
  return {
    tenant: "tenant-1",
    externalConnectionId: "00000000-0000-4000-8000-0000000000c1",
    payloadRegistry: new JiraPlanPayloadRegistry(),
  };
}

describe("planIssueTransition — failing-first: a resolved, exactly-matching verification pointer satisfies the done-transition guard with NO hand-passed hasVerificationEvidence boolean", () => {
  it("does NOT throw when resolveVerificationPointer resolves an exact-match pointer for the issue/revision, and hasVerificationEvidence is omitted (defaults false)", () => {
    expect(() =>
      planIssueTransition(
        planCtx(),
        "PROJ-1",
        "7",
        "31",
        true,
        "00000000-0000-4000-8000-000000000001",
        undefined,
        () => ({ remoteResourceId: "PROJ-1", confirmedRevision: "7" }),
      ),
    ).not.toThrow();
  });

  it("still throws policy_blocked when the resolver returns a pointer for a DIFFERENT revision (not an exact match)", () => {
    expect(() =>
      planIssueTransition(
        planCtx(),
        "PROJ-1",
        "7",
        "31",
        true,
        "00000000-0000-4000-8000-000000000001",
        undefined,
        () => ({ remoteResourceId: "PROJ-1", confirmedRevision: "6" }),
      ),
    ).toThrow(ConnectorError);
  });

  it("still throws policy_blocked when no resolver is supplied at all and hasVerificationEvidence is omitted (backward-compatible default)", () => {
    expect(() =>
      planIssueTransition(
        planCtx(),
        "PROJ-1",
        "7",
        "31",
        true,
        "00000000-0000-4000-8000-000000000001",
      ),
    ).toThrow(ConnectorError);
  });

  it("the caller-supplied hasVerificationEvidence=true STILL works as a fallback/override even with no resolver (exact pre-existing behavior preserved)", () => {
    expect(() =>
      planIssueTransition(
        planCtx(),
        "PROJ-1",
        "7",
        "31",
        true,
        "00000000-0000-4000-8000-000000000001",
        true,
      ),
    ).not.toThrow();
  });

  it("a non-done-targeting transition never consults the resolver at all (no evidence required)", () => {
    expect(() =>
      planIssueTransition(
        planCtx(),
        "PROJ-1",
        "7",
        "11",
        false,
        "00000000-0000-4000-8000-000000000001",
        undefined,
        () => undefined,
      ),
    ).not.toThrow();
  });
});
