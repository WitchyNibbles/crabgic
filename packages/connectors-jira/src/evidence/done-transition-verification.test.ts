import { describe, expect, it } from "vitest";
import { assertDoneTransitionHasEvidence } from "../resource-client/issue-plans.js";
import { hasExactRevisionVerification } from "./done-transition-verification.js";

describe("hasExactRevisionVerification", () => {
  it("false when no pointer exists", () => {
    expect(hasExactRevisionVerification(undefined, "remote-1", "7")).toBe(false);
  });

  it("false when the pointer targets a DIFFERENT RemoteResource", () => {
    expect(
      hasExactRevisionVerification(
        { remoteResourceId: "remote-other", confirmedRevision: "7" },
        "remote-1",
        "7",
      ),
    ).toBe(false);
  });

  it("false when the confirmed revision does not exactly match", () => {
    expect(
      hasExactRevisionVerification(
        { remoteResourceId: "remote-1", confirmedRevision: "6" },
        "remote-1",
        "7",
      ),
    ).toBe(false);
  });

  it("false when the pointer has no confirmed revision at all", () => {
    expect(hasExactRevisionVerification({ remoteResourceId: "remote-1" }, "remote-1", "7")).toBe(
      false,
    );
  });

  it("true on an exact RemoteResource id + revision match", () => {
    expect(
      hasExactRevisionVerification(
        { remoteResourceId: "remote-1", confirmedRevision: "7" },
        "remote-1",
        "7",
      ),
    ).toBe(true);
  });

  it("feeds directly into assertDoneTransitionHasEvidence: a done-targeting transition with a verified pointer never throws", () => {
    const verified = hasExactRevisionVerification(
      { remoteResourceId: "remote-1", confirmedRevision: "7" },
      "remote-1",
      "7",
    );
    expect(() => assertDoneTransitionHasEvidence(true, verified)).not.toThrow();
  });

  it("feeds directly into assertDoneTransitionHasEvidence: a done-targeting transition with NO verified pointer throws (policy_blocked)", () => {
    const verified = hasExactRevisionVerification(undefined, "remote-1", "7");
    expect(() => assertDoneTransitionHasEvidence(true, verified)).toThrow();
  });
});
