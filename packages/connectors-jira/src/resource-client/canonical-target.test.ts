import { describe, expect, it } from "vitest";
import {
  attachmentTarget,
  boardTarget,
  commentTarget,
  issueTarget,
  sprintTarget,
  worklogTarget,
  writeSerializationTarget,
} from "./canonical-target.js";

/**
 * `writeSerializationTarget` is the derivation behind roadmap/18 exit
 * criterion 10's second clause ("per-issue write order preserved"):
 * every issue-scoped write this connector mints — field update, comment,
 * worklog, attachment — must collapse onto ONE serialization key,
 * `issue:<key>`, so 16's per-tenant+resource write mutex
 * (`@crabgic/gateway`'s `WriteSerializer`) actually serializes them
 * against each other. Identity (`canonicalTarget`) is deliberately NOT
 * collapsed: `./jira-mutation-apply-client.ts` and
 * `./datacenter/jira-mutation-apply-client-dc.ts` both parse a
 * `commentId` back out of it.
 *
 * The table below is driven by the REAL minting helpers in the same
 * module rather than by hand-written strings, so a change to any
 * `*Target` helper's shape is caught here rather than silently
 * bypassing the derivation.
 */
describe("writeSerializationTarget — every issue-scoped shape collapses to issue:<key>", () => {
  const issueScoped: ReadonlyArray<readonly [string, string]> = [
    ["issues.planUpdate / planTransition / planLink", issueTarget("PROJ-1")],
    ["comments.planCreate", commentTarget("PROJ-1")],
    ["comments.planUpdate", commentTarget("PROJ-1", "77")],
    ["worklogs.planCreate", worklogTarget("PROJ-1")],
    ["attachments.planUpload", attachmentTarget("PROJ-1")],
  ];

  it.each(issueScoped)("%s (%s) serializes on issue:PROJ-1", (_label, canonicalTarget) => {
    expect(writeSerializationTarget(canonicalTarget)).toBe("issue:PROJ-1");
  });

  it("keeps every issue-scoped shape distinct as IDENTITY while collapsing it for serialization", () => {
    const identities = issueScoped.map(([, target]) => target);
    // Identity is not collapsed — five distinct canonicalTargets…
    expect(new Set(identities).size).toBe(5);
    // …that all take the SAME write mutex.
    expect(new Set(identities.map(writeSerializationTarget)).size).toBe(1);
  });

  it("keeps different issues on different keys (cross-issue parallelism is preserved)", () => {
    expect(writeSerializationTarget(commentTarget("PROJ-2"))).toBe("issue:PROJ-2");
    expect(writeSerializationTarget(issueTarget("PROJ-1"))).not.toBe(
      writeSerializationTarget(issueTarget("PROJ-2")),
    );
  });
});

describe("writeSerializationTarget — non-issue-scoped targets pass through unchanged", () => {
  const passthrough: ReadonlyArray<readonly [string, string]> = [
    ["boards.planUpdate / planRankIssues", boardTarget(7)],
    ["sprints.planStart / planComplete / planMoveIssues", sprintTarget(3)],
    // The remaining shapes are minted inline by the plan builders rather
    // than by a `*Target` helper (`./issue-plans.ts:63,189,210`,
    // `./board-sprint-plans.ts:13,76`) — none of them names an existing
    // issue, so none may be folded onto an issue's mutex.
    ["issues.planCreate", "project:PROJ:new-issue"],
    ["boards.planCreate", "project:PROJ:new-board"],
    ["sprints.planCreate", "board:7:new-sprint"],
    ["issues.planBulkUpdate / planBulkTransition", "bulk:PROJ-1,PROJ-2"],
  ];

  it.each(passthrough)("%s (%s) is returned unchanged", (_label, canonicalTarget) => {
    expect(writeSerializationTarget(canonicalTarget)).toBe(canonicalTarget);
  });

  it("returns an unrecognized shape unchanged rather than guessing", () => {
    expect(writeSerializationTarget("something-else")).toBe("something-else");
    expect(writeSerializationTarget("")).toBe("");
    // "issue" with no key is not an issue target — do not invent one.
    expect(writeSerializationTarget("issue")).toBe("issue");
  });
});
