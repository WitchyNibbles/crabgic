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

describe("writeSerializationTarget — every other target passes through unchanged", () => {
  const passthrough: ReadonlyArray<readonly [string, string]> = [
    ["boards.planUpdate / planRankIssues", boardTarget(7)],
    ["sprints.planStart / planComplete / planMoveIssues", sprintTarget(3)],
    // Minted inline by the plan builders rather than by a `*Target`
    // helper (`./issue-plans.ts:63`, `./board-sprint-plans.ts:13,76`).
    // These name no existing issue — there is nothing to serialize
    // against yet.
    ["issues.planCreate", "project:PROJ:new-issue"],
    ["boards.planCreate", "project:PROJ:new-board"],
    ["sprints.planCreate", "board:7:new-sprint"],
  ];

  it.each(passthrough)("%s (%s) is returned unchanged", (_label, canonicalTarget) => {
    expect(writeSerializationTarget(canonicalTarget)).toBe(canonicalTarget);
  });

  /**
   * `bulk:` is the one passthrough that is NOT "not an issue write" — it
   * is a write to several existing, named issues (`./issue-plans.ts:189`,
   * `:210`), and the keys are in the target string. It passes through
   * because a mutex key is a single string and no single key can mean
   * "PROJ-1 and PROJ-2 at once"; folding it onto either one would be
   * wrong. The residual this leaves is deliberate, and asserted rather
   * than merely described so it cannot quietly change.
   */
  it("KNOWN RESIDUAL: a bulk target is left unserialized against its own member issues", () => {
    const bulk = "bulk:PROJ-1,PROJ-2";
    expect(writeSerializationTarget(bulk)).toBe(bulk);
    // The residual, stated as the assertion it is: a bulk write touching
    // PROJ-1 does NOT take PROJ-1's mutex, so it can race a single-issue
    // write to PROJ-1.
    expect(writeSerializationTarget(bulk)).not.toBe(
      writeSerializationTarget(issueTarget("PROJ-1")),
    );
    // And two bulk plans over the same issues in a different order mint
    // different keys, so they do not serialize against each other either.
    expect(writeSerializationTarget("bulk:PROJ-2,PROJ-1")).not.toBe(writeSerializationTarget(bulk));
  });

  it("returns an unrecognized shape unchanged rather than guessing", () => {
    expect(writeSerializationTarget("something-else")).toBe("something-else");
    expect(writeSerializationTarget("")).toBe("");
    // "issue" with no key is not an issue target — do not invent one.
    expect(writeSerializationTarget("issue")).toBe("issue");
  });
});
