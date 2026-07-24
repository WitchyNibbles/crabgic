import { describe, expect, it } from "vitest";
import { ScenarioAssertionError, exitStatusFor, requirePassed } from "../src/scenario-types.js";

describe("scenario-types (pure guards, both branches)", () => {
  describe("exitStatusFor", () => {
    it("returns 0 when passed is true", () => {
      expect(exitStatusFor(true)).toBe(0);
    });

    it("returns 1 when passed is false", () => {
      expect(exitStatusFor(false)).toBe(1);
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
        expect((err as Error).name).toBe("ScenarioAssertionError");
      }
    });
  });
});
