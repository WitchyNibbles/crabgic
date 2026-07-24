import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  isJiraWorkflowStage,
  JIRA_WORKFLOW_STAGES,
  mapJiraStatusToWorkflowStage,
} from "./workflow-stage.js";

describe("mapJiraStatusToWorkflowStage — known status names", () => {
  it.each([
    ["To Do", "planned"],
    ["Open", "planned"],
    ["Backlog", "planned"],
    ["In Progress", "in_progress"],
    ["In Review", "in_progress"],
    ["Done", "done"],
    ["Closed", "done"],
    ["Resolved", "done"],
  ] as const)("maps %s -> %s", (statusName, expected) => {
    expect(mapJiraStatusToWorkflowStage(statusName)).toBe(expected);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(mapJiraStatusToWorkflowStage("  dOnE  ")).toBe("done");
  });

  // Discovered via the M3 property-test broadening below (fast-check
  // counterexample `"__proto__"`, seed 536878112): a plain-object lookup
  // table is vulnerable to JavaScript's own prototype-chain special-
  // casing — `obj["__proto__"]`/`obj["constructor"]`/`obj["toString"]`
  // resolve to inherited `Object.prototype` members (an OBJECT, not
  // `undefined`) rather than "not found," so `known !== undefined`
  // spuriously passed and this function returned `Object.prototype`
  // itself instead of a `JiraWorkflowStage` string — never-guess broken
  // by construction for these specific inputs, independent of any
  // category hint.
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"])(
    "never returns a non-string/inherited value for the dangerous key %j — always a real JiraWorkflowStage",
    (dangerousKey) => {
      const result = mapJiraStatusToWorkflowStage(dangerousKey);
      expect(typeof result).toBe("string");
      expect(["planned", "in_progress", "blocked", "done"]).toContain(result);
      expect(result).toBe("blocked");
    },
  );
});

describe("mapJiraStatusToWorkflowStage — never-guess rule", () => {
  it("an unrecognized status with no category hint resolves to blocked, never done", () => {
    expect(mapJiraStatusToWorkflowStage("Frobnicating")).toBe("blocked");
  });

  it("an unrecognized status uses the done status-category hint", () => {
    expect(mapJiraStatusToWorkflowStage("Ready for Release", "done")).toBe("done");
  });

  it("an unrecognized status uses the new status-category hint", () => {
    expect(mapJiraStatusToWorkflowStage("Triage", "new")).toBe("planned");
  });

  it("an unrecognized status uses the indeterminate status-category hint", () => {
    expect(mapJiraStatusToWorkflowStage("Cooking", "indeterminate")).toBe("in_progress");
  });

  it("property: any status name absent from the known table and with no category hint never resolves to done", () => {
    const knownNames = new Set([
      "to do",
      "open",
      "backlog",
      "selected for development",
      "in progress",
      "in review",
      "in development",
      "reopened",
      "done",
      "closed",
      "resolved",
    ]);
    fc.assert(
      fc.property(fc.string(), (statusName) => {
        fc.pre(!knownNames.has(statusName.trim().toLowerCase()));
        expect(mapJiraStatusToWorkflowStage(statusName)).toBe("blocked");
      }),
    );
  });

  // MEDIUM M3 (adversarial-review): the exit-criterion wording ("fuzzed/
  // unrecognized names always resolve to blocked, never done") is
  // deliberately narrowed here to the cases where trusting Jira is not
  // itself the safe reading — see `workflow-stage.ts`'s own module doc
  // comment for the documented rationale. The suite below now proves
  // BOTH halves explicitly, rather than the prior revision's single
  // property that silently EXCLUDED the done-category case from the
  // "never done" claim (leaving it unproven, per the finding).
  const knownStatusNames = new Set([
    "to do",
    "open",
    "backlog",
    "selected for development",
    "in progress",
    "in review",
    "in development",
    "reopened",
    "done",
    "closed",
    "resolved",
  ]);

  it("property: an unrecognized status name NEVER resolves to done when the category hint is absent or non-done", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.constantFrom<"new" | "indeterminate" | undefined>("new", "indeterminate", undefined),
        (statusName, categoryKey) => {
          fc.pre(!knownStatusNames.has(statusName.trim().toLowerCase()));
          expect(mapJiraStatusToWorkflowStage(statusName, categoryKey)).not.toBe("done");
        },
      ),
    );
  });

  it("property: an unrecognized status name with Jira's own done CATEGORY hint always resolves to done — documented, intentional, not a guess", () => {
    fc.assert(
      fc.property(fc.string(), (statusName) => {
        fc.pre(!knownStatusNames.has(statusName.trim().toLowerCase()));
        expect(mapJiraStatusToWorkflowStage(statusName, "done")).toBe("done");
      }),
    );
  });

  it("property: an unrecognized status name never resolves to planned/in_progress unless the category hint says so", () => {
    fc.assert(
      fc.property(fc.string(), (statusName) => {
        fc.pre(!knownStatusNames.has(statusName.trim().toLowerCase()));
        expect(mapJiraStatusToWorkflowStage(statusName, undefined)).toBe("blocked");
      }),
    );
  });
});

describe("JIRA_WORKFLOW_STAGES / isJiraWorkflowStage", () => {
  it("is the exact 4-member closed union", () => {
    expect(JIRA_WORKFLOW_STAGES).toEqual(["planned", "in_progress", "blocked", "done"]);
  });

  it.each(JIRA_WORKFLOW_STAGES)("recognizes %s as a valid stage", (stage) => {
    expect(isJiraWorkflowStage(stage)).toBe(true);
  });

  it("rejects an unrelated string", () => {
    expect(isJiraWorkflowStage("cancelled")).toBe(false);
    expect(isJiraWorkflowStage(42)).toBe(false);
  });
});
