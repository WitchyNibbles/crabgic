import { describe, expect, it } from "vitest";
import { isPassiveMode, PASSIVE_MODE_ENV_VAR } from "./passive-mode.js";

describe("isPassiveMode", () => {
  it("is off when the variable is absent", () => {
    expect(isPassiveMode({})).toBe(false);
  });

  it("accepts the two documented truthy spellings, case-insensitively", () => {
    for (const value of ["1", "true", "TRUE", "True", " true ", "\t1\n"]) {
      expect(
        isPassiveMode({ [PASSIVE_MODE_ENV_VAR]: value }),
        `value=${JSON.stringify(value)}`,
      ).toBe(true);
    }
  });

  it("ignores anything else rather than guessing", () => {
    // A stray or misspelled export must never silently stop the CLI from
    // starting the daemon ordinary commands depend on.
    for (const value of ["", "0", "false", "no", "yes", "on", "2", "passive", "  "]) {
      expect(
        isPassiveMode({ [PASSIVE_MODE_ENV_VAR]: value }),
        `value=${JSON.stringify(value)}`,
      ).toBe(false);
    }
  });

  it("ignores an undefined value the way an absent key is ignored", () => {
    expect(isPassiveMode({ [PASSIVE_MODE_ENV_VAR]: undefined })).toBe(false);
  });

  it("keys off the documented variable name only", () => {
    expect(PASSIVE_MODE_ENV_VAR).toBe("CRABGIC_NO_SPAWN");
    expect(isPassiveMode({ CRABGIC_PASSIVE: "1", NO_SPAWN: "1" })).toBe(false);
  });
});
