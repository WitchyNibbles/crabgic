import { describe, expect, it } from "vitest";
import {
  ScenarioAssertionError,
  ScenarioSetupError,
  findOutcomeAction,
  requirePassed,
  requireStatus,
} from "../src/scenario-support.js";

describe("scenario-support (pure guards, both branches)", () => {
  describe("requireStatus", () => {
    it("does nothing when actual === expected", () => {
      expect(() => requireStatus("installed", "installed", "example")).not.toThrow();
    });

    it("throws ScenarioSetupError when actual !== expected", () => {
      expect(() => requireStatus("already-installed", "installed", "example")).toThrow(
        ScenarioSetupError,
      );
      try {
        requireStatus("already-installed", "installed", "example");
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ScenarioSetupError);
        expect((err as Error).message).toContain("example");
        expect((err as Error).message).toContain("already-installed");
      }
    });
  });

  describe("requirePassed", () => {
    it("does nothing when passed is true", () => {
      expect(() => requirePassed(true, "some-scenario", "irrelevant detail")).not.toThrow();
    });

    it("throws ScenarioAssertionError with the scenario name and detail when passed is false", () => {
      expect(() => requirePassed(false, "some-scenario", "the reason")).toThrow(
        ScenarioAssertionError,
      );
      try {
        requirePassed(false, "some-scenario", "the reason");
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ScenarioAssertionError);
        expect((err as Error).message).toBe("some-scenario: the reason");
      }
    });
  });

  describe("findOutcomeAction", () => {
    it("returns the matching outcome's action when relPath is present", () => {
      const outcomes = [
        { relPath: "CLAUDE.md", action: "preserved-drifted" },
        { relPath: ".mcp.json", action: "removed" },
      ];
      expect(findOutcomeAction(outcomes, "CLAUDE.md")).toBe("preserved-drifted");
    });

    it('returns "MISSING" when no outcome names relPath at all', () => {
      const outcomes = [{ relPath: ".mcp.json", action: "removed" }];
      expect(findOutcomeAction(outcomes, "CLAUDE.md")).toBe("MISSING");
    });
  });
});
