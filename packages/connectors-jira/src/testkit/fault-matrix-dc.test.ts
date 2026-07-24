import { describe, expect, it } from "vitest";
import { JIRA_DATACENTER_FAULT_MATRIX } from "./fault-matrix-dc.js";

/**
 * roadmap/19-jira-datacenter-adapter.md §In scope, "Rate limits" bullet:
 * "DC deployments typically have no Cloud-style quota/burst headers ...
 * this phase's fixtures must not assert a `Retry-After` contract DC
 * doesn't make — conformance parameterization treats rate-limit-header
 * presence as a per-deployment-type fixture property, not a shared
 * assertion." This matrix's own `rateLimited` entry (if present at all)
 * must therefore never carry a `retry-after` header the way
 * `@eo/gateway`'s `FULL_FAULT_MATRIX.rateLimited` does for Cloud.
 */
describe("JIRA_DATACENTER_FAULT_MATRIX", () => {
  it("covers 401/403/409/429/malformed-page/mid-POST-timeout, same shared set 18 extends", () => {
    expect(JIRA_DATACENTER_FAULT_MATRIX["authFailure"]?.status).toBe(401);
    expect(JIRA_DATACENTER_FAULT_MATRIX["forbidden"]?.status).toBe(403);
    expect(JIRA_DATACENTER_FAULT_MATRIX["conflict"]?.status).toBe(409);
    expect(JIRA_DATACENTER_FAULT_MATRIX["rateLimited"]?.status).toBe(429);
    expect(JIRA_DATACENTER_FAULT_MATRIX["malformedPage"]).toBeDefined();
    expect(JIRA_DATACENTER_FAULT_MATRIX["midPostTimeout"]).toBeDefined();
  });

  it("its own rateLimited entry carries NO retry-after header — DC has no Cloud-style quota/burst headers by convention", () => {
    const entry = JIRA_DATACENTER_FAULT_MATRIX["rateLimited"];
    expect(entry?.headers?.["retry-after"]).toBeUndefined();
  });
});
