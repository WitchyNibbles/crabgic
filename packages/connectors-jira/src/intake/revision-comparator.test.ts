import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildRemoteResource } from "@eo/testkit";
import { compareRemoteResourceRevisions, stampJiraRemoteResource } from "./revision-comparator.js";

/**
 * roadmap/18 §Exit criteria: "Revision comparator detects a seeded
 * material remote edit between two milestone polls and produces the
 * amendment-review signal." §Test plan Property bullet: "revision-
 * comparator diffing over arbitrary field mutations between two
 * snapshots (must be flagged material or explicitly excluded, never
 * silently dropped)."
 */
describe("stampJiraRemoteResource", () => {
  it("builds a valid RemoteResource stamp for a tracked issue", () => {
    const stamp = stampJiraRemoteResource({
      externalConnectionId: "11111111-1111-4111-8111-111111111111",
      issueKey: "PROJ-1",
      revision: "rev-1",
      observedAt: "2026-01-01T00:00:00.000Z",
      canonicalUrl: "https://example.atlassian.net/browse/PROJ-1",
    });
    expect(stamp.resourceKind).toBe("issue");
    expect(stamp.externalId).toBe("PROJ-1");
    expect(stamp.revision).toBe("rev-1");
  });
});

describe("compareRemoteResourceRevisions", () => {
  it("flags a material change when the revision differs between two stamps of the same resource", () => {
    const previous = buildRemoteResource({ externalId: "PROJ-1", revision: "rev-1" });
    const current = buildRemoteResource({ externalId: "PROJ-1", revision: "rev-2" });

    const signal = compareRemoteResourceRevisions(previous, current);

    expect(signal.material).toBe(true);
  });

  it("reports no material change when the revision is identical across two polls", () => {
    const previous = buildRemoteResource({ externalId: "PROJ-1", revision: "rev-1" });
    const current = buildRemoteResource({ externalId: "PROJ-1", revision: "rev-1" });

    const signal = compareRemoteResourceRevisions(previous, current);

    expect(signal.material).toBe(false);
  });

  it("throws when the two stamps reference different resources — never silently compares unrelated resources", () => {
    const previous = buildRemoteResource({ externalId: "PROJ-1", revision: "rev-1" });
    const current = buildRemoteResource({ externalId: "PROJ-2", revision: "rev-2" });

    expect(() => compareRemoteResourceRevisions(previous, current)).toThrow();
  });

  const nonBlankString = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

  it("property: any pair of distinct revision strings for the same resource is always flagged material — never silently dropped", () => {
    fc.assert(
      fc.property(nonBlankString, nonBlankString, (revisionA, revisionB) => {
        fc.pre(revisionA.trim() !== revisionB.trim());
        const previous = buildRemoteResource({ externalId: "PROJ-1", revision: revisionA });
        const current = buildRemoteResource({ externalId: "PROJ-1", revision: revisionB });
        const signal = compareRemoteResourceRevisions(previous, current);
        expect(signal.material).toBe(true);
      }),
    );
  });

  it("property: an identical revision string, however arbitrary, is always non-material", () => {
    fc.assert(
      fc.property(nonBlankString, (revision) => {
        const previous = buildRemoteResource({ externalId: "PROJ-1", revision });
        const current = buildRemoteResource({ externalId: "PROJ-1", revision });
        const signal = compareRemoteResourceRevisions(previous, current);
        expect(signal.material).toBe(false);
      }),
    );
  });
});
