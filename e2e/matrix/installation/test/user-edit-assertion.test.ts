import { describe, expect, it } from "vitest";
import {
  UserEditOverwrittenError,
  assertUserEditsPreserved,
  findUserEditOverwriteViolations,
} from "../src/user-edit-assertion.js";

/**
 * roadmap/23-release-hardening.md work item 3's fail-first vector,
 * verbatim: "a seeded fixture where the installer SILENTLY OVERWRITES a
 * user edit must FAIL the harness before the assertion is in place." This
 * file IS that proof: a seeded, broken-installer-shaped double (never a
 * real installer call) is fed straight to the assertion this project
 * trusts to certify a real run — proving the assertion itself catches the
 * bug BEFORE any real installer is ever exercised (see
 * `uninstall-preserving-edits-scenario.test.ts` for the real-installer
 * GREEN counterpart of the same assertion).
 */
describe("findUserEditOverwriteViolations / assertUserEditsPreserved (RED before GREEN)", () => {
  it("RED: a broken-installer double that reports 'removed' for a drifted (user-edited) path is caught", () => {
    const brokenDoubleOutcomes = [
      { relPath: "CLAUDE.md", action: "removed" as const },
      { relPath: ".claude/agents/eo-explore.md", action: "already-absent" as const },
    ];

    const violations = findUserEditOverwriteViolations(brokenDoubleOutcomes, ["CLAUDE.md"]);
    expect(violations).toEqual([{ relPath: "CLAUDE.md", action: "removed" }]);

    expect(() => assertUserEditsPreserved(brokenDoubleOutcomes, ["CLAUDE.md"])).toThrow(
      UserEditOverwrittenError,
    );
  });

  it("RED: a broken-installer double that 'restores' (overwrites with the pre-install snapshot) a drifted path is also caught", () => {
    const brokenDoubleOutcomes = [
      { relPath: ".claude/settings.json", action: "restored" as const },
    ];
    expect(
      findUserEditOverwriteViolations(brokenDoubleOutcomes, [".claude/settings.json"]),
    ).toHaveLength(1);
  });

  it("GREEN: a correct-installer double that reports 'preserved-drifted' for the drifted path passes clean", () => {
    const correctDoubleOutcomes = [
      { relPath: "CLAUDE.md", action: "preserved-drifted" as const },
      { relPath: ".claude/agents/eo-reviewer.md", action: "removed" as const },
    ];

    expect(findUserEditOverwriteViolations(correctDoubleOutcomes, ["CLAUDE.md"])).toEqual([]);
    expect(() => assertUserEditsPreserved(correctDoubleOutcomes, ["CLAUDE.md"])).not.toThrow();
  });

  it("a path never claimed as drifted is never flagged, regardless of its action", () => {
    const outcomes = [{ relPath: "some/other/file.md", action: "removed" as const }];
    expect(findUserEditOverwriteViolations(outcomes, ["CLAUDE.md"])).toEqual([]);
  });

  it("UserEditOverwrittenError carries every violation and a human-legible message", () => {
    const violations = [{ relPath: "CLAUDE.md", action: "removed" as const }];
    const err = new UserEditOverwrittenError(violations);
    expect(err.violations).toBe(violations);
    expect(err.message).toContain("CLAUDE.md");
    expect(err.message).toContain("removed");
    expect(err.name).toBe("UserEditOverwrittenError");
  });

  it("multiple drifted paths are all reported, not just the first", () => {
    const outcomes = [
      { relPath: "a.md", action: "removed" as const },
      { relPath: "b.md", action: "restored" as const },
      { relPath: "c.md", action: "preserved-drifted" as const },
    ];
    const violations = findUserEditOverwriteViolations(outcomes, ["a.md", "b.md", "c.md"]);
    expect(violations.map((v) => v.relPath).sort()).toEqual(["a.md", "b.md"]);
  });
});
