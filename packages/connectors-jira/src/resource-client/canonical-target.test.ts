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

  it("returns an unrecognized shape unchanged rather than guessing", () => {
    expect(writeSerializationTarget("something-else")).toBe("something-else");
    expect(writeSerializationTarget("")).toBe("");
    // "issue" with no key is not an issue target — do not invent one.
    expect(writeSerializationTarget("issue")).toBe("issue");
  });
});

/**
 * `bulk:<key>,<key>,…` (`./issue-plans.ts:189`, `:210` —
 * `issue.bulkUpdate`/`issue.bulkTransition`) is a write to several
 * EXISTING, NAMED issues, and the keys are right there in the target.
 * Until 16's `WriteSerializer` grew multi-key acquisition
 * (`packages/gateway/src/transport/write-serializer.ts`'s
 * `runExclusiveMulti`) there was no key that could mean "PROJ-1 and
 * PROJ-2 at once", so this target passed through unchanged and the
 * residual was pinned here as an assertion. That residual is now
 * CLOSED — these cases replace it, and the two assertions below marked
 * "was the residual" are the exact inversions of what this file
 * previously asserted.
 *
 * ⚠️ The sorting/dedup cases below pin a LOCAL contract, not the
 * end-to-end guarantee, and the difference was measured rather than
 * assumed: deleting `.sort()` from the production mapping reddens the
 * order-permutation case HERE and leaves every connector integration case
 * in `../testkit/write-order.integration.test.ts` green, because 16's
 * `WriteSerializer.runExclusiveMulti` canonicalizes the key set again on
 * its own side. These are defence-in-depth pins. The integration cases
 * are the bearer for the criterion.
 */
describe("writeSerializationTarget — a bulk target maps to its member issues' keys", () => {
  it("maps bulk:PROJ-1,PROJ-2 onto both member issue keys", () => {
    expect(writeSerializationTarget("bulk:PROJ-1,PROJ-2")).toEqual([
      "issue:PROJ-1",
      "issue:PROJ-2",
    ]);
  });

  it("was the residual: a bulk write now takes the mutex of each member issue", () => {
    const keys = writeSerializationTarget("bulk:PROJ-1,PROJ-2");
    // Previously `expect(...).not.toBe(writeSerializationTarget(issueTarget("PROJ-1")))` —
    // a bulk write could race a single-issue write to PROJ-1.
    expect(keys).toContain(writeSerializationTarget(issueTarget("PROJ-1")));
    expect(keys).toContain(writeSerializationTarget(issueTarget("PROJ-2")));
    // Cross-issue parallelism is still preserved — PROJ-3 is untouched.
    expect(keys).not.toContain(writeSerializationTarget(issueTarget("PROJ-3")));
  });

  it("was the residual: order-permuted member lists mint the SAME key set", () => {
    // Previously `expect(writeSerializationTarget("bulk:PROJ-2,PROJ-1")).not.toBe(...)`.
    expect(writeSerializationTarget("bulk:PROJ-2,PROJ-1")).toEqual(
      writeSerializationTarget("bulk:PROJ-1,PROJ-2"),
    );
  });

  it("dedupes a repeated member key", () => {
    expect(writeSerializationTarget("bulk:PROJ-1,PROJ-1,PROJ-2")).toEqual([
      "issue:PROJ-1",
      "issue:PROJ-2",
    ]);
  });

  it("a single-member bulk target is the SAME shape as the single-issue write it races", () => {
    // One member ⇒ one key. The gateway's single-key path is then
    // byte-for-byte the pre-existing behaviour
    // (`mutation-pipeline.ts`: `targets.length > 1` is what switches on
    // `serializationResources`), so this collapses onto `issue:PROJ-1`
    // with no plural machinery involved at all.
    expect(writeSerializationTarget("bulk:PROJ-1")).toEqual(["issue:PROJ-1"]);
  });

  it("a bulk target naming no issue is returned unchanged rather than left unkeyed", () => {
    // A write is never left without a serialization key. Returning the
    // canonical target itself (rather than an empty array, which would
    // lean on the pipeline's own fallback) keeps the answer decidable
    // here, in the one module that owns this parse.
    expect(writeSerializationTarget("bulk:")).toBe("bulk:");
    expect(writeSerializationTarget("bulk:,,")).toBe("bulk:,,");
  });
});
