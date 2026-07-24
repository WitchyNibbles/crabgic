import { describe, expect, it } from "vitest";
import { CONNECTOR_ERROR_KINDS, type ConnectorErrorKind } from "@eo/contracts";
import { mapJiraStatusToConnectorErrorKind } from "./jira-error-mapping.js";

/**
 * roadmap/18 §Test plan, Unit bullet: "canonical-error mapping table (every
 * Jira REST status code → exactly one of the 10 members)." This phase
 * reuses `@eo/gateway`'s `mapHttpStatusToConnectorError` (never
 * reimplements it — roadmap/18 §Out of scope: "Generic transport
 * security... canonical-error mapping mechanics... → 16"); this test
 * proves the exhaustive Jira-relevant status table this connector actually
 * exercises resolves to exactly one canonical kind per status, with no
 * raw Jira response body ever surfacing in the mapped result.
 */
describe("mapJiraStatusToConnectorErrorKind — every Jira REST status maps to exactly one canonical kind", () => {
  it.each([
    [400, "validation"],
    [401, "authentication"],
    [403, "permission"],
    [404, "not_found"],
    [409, "conflict"],
    [412, "conflict"],
    [422, "validation"],
    [429, "rate_limited"],
    [500, "transient"],
    [502, "transient"],
    [503, "transient"],
    [504, "transient"],
    [501, "unsupported"],
    [418, "transient"], // an unrecognized-but-error status still lands on exactly one member (transient), never unmapped
  ] as const)("HTTP %d -> %s", (status, expectedKind) => {
    const err = mapJiraStatusToConnectorErrorKind(status, { secret: "must-not-leak" });
    expect(err.kind).toBe(expectedKind);
    expect((CONNECTOR_ERROR_KINDS as readonly ConnectorErrorKind[]).includes(err.kind)).toBe(true);
  });

  it("never leaks the raw provider response body in the mapped error", () => {
    const err = mapJiraStatusToConnectorErrorKind(401, {
      errorMessages: ["super secret internal detail"],
    });
    expect(err.message).not.toContain("super secret internal detail");
    expect(err.redactedDetail).not.toContain("super secret internal detail");
    expect(JSON.stringify(err.toData())).not.toContain("super secret internal detail");
  });

  it("provider is always attributed to jira-cloud", () => {
    const err = mapJiraStatusToConnectorErrorKind(404, undefined);
    expect(err.provider).toBe("jira-cloud");
  });
});
