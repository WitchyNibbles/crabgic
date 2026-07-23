/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_ENGINE_VERSION_RANGE,
  ACCEPTED_SDK_VERSION_RANGE,
  TESTED_ENGINE_VERSION,
  EngineVersionRejectedError,
  assertEngineVersionAccepted,
} from "./version-gate.js";

/**
 * `version-gate` (roadmap/06-claude-engine-adapter.md §In scope, "Version
 * gate"; exit criterion `version-gate.test`; docs/engine-baseline.md
 * §10). `spawn`/`resume` refuse outside the accepted range recorded in
 * the baseline document — this module's constants ARE that citation, and
 * the baseline-sync test below fails closed if the constants and the
 * document ever drift apart.
 */
const BASELINE_DOC_PATH = fileURLToPath(
  new URL("../../../docs/engine-baseline.md", import.meta.url),
);

describe("version range constants", () => {
  it("ACCEPTED_ENGINE_VERSION_RANGE matches docs/engine-baseline.md's accepted range", () => {
    expect(ACCEPTED_ENGINE_VERSION_RANGE).toEqual({ min: "2.1.207", max: "2.1.210" });
  });

  it("ACCEPTED_SDK_VERSION_RANGE matches docs/engine-baseline.md's accepted SDK range", () => {
    expect(ACCEPTED_SDK_VERSION_RANGE).toEqual({ min: "0.3.207", max: "0.3.210" });
  });

  it("TESTED_ENGINE_VERSION is the baseline's tested version, inside the accepted range", () => {
    expect(TESTED_ENGINE_VERSION).toBe("2.1.210");
  });
});

describe("assertEngineVersionAccepted — acceptance", () => {
  it("accepts the minimum of the range", () => {
    expect(() => assertEngineVersionAccepted(ACCEPTED_ENGINE_VERSION_RANGE.min)).not.toThrow();
  });

  it("accepts the maximum of the range", () => {
    expect(() => assertEngineVersionAccepted(ACCEPTED_ENGINE_VERSION_RANGE.max)).not.toThrow();
  });

  it("accepts a version strictly between the min and max", () => {
    expect(() => assertEngineVersionAccepted("2.1.208")).not.toThrow();
  });

  it("accepts the tested version", () => {
    expect(() => assertEngineVersionAccepted(TESTED_ENGINE_VERSION)).not.toThrow();
  });
});

describe("assertEngineVersionAccepted — refusal", () => {
  it("refuses a version below the range", () => {
    expect(() => assertEngineVersionAccepted("2.1.206")).toThrow(EngineVersionRejectedError);
  });

  it("refuses a version above the range", () => {
    expect(() => assertEngineVersionAccepted("2.1.211")).toThrow(EngineVersionRejectedError);
  });

  it("refuses a version from an entirely different minor line", () => {
    expect(() => assertEngineVersionAccepted("2.2.0")).toThrow(EngineVersionRejectedError);
  });

  it("marks an out-of-range refusal with reason 'out-of-range'", () => {
    try {
      assertEngineVersionAccepted("2.1.211");
      expect.unreachable("expected assertEngineVersionAccepted to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EngineVersionRejectedError);
      expect((error as EngineVersionRejectedError).reason).toBe("out-of-range");
      expect((error as EngineVersionRejectedError).version).toBe("2.1.211");
    }
  });

  it("refuses a malformed version string (missing a component)", () => {
    expect(() => assertEngineVersionAccepted("2.1")).toThrow(EngineVersionRejectedError);
  });

  it("refuses a malformed version string (non-numeric component)", () => {
    expect(() => assertEngineVersionAccepted("2.1.x")).toThrow(EngineVersionRejectedError);
  });

  it("refuses a malformed version string (extra component)", () => {
    expect(() => assertEngineVersionAccepted("2.1.210.1")).toThrow(EngineVersionRejectedError);
  });

  it("refuses an empty version string", () => {
    expect(() => assertEngineVersionAccepted("")).toThrow(EngineVersionRejectedError);
  });

  it("marks a malformed refusal with reason 'malformed'", () => {
    try {
      assertEngineVersionAccepted("not-a-version");
      expect.unreachable("expected assertEngineVersionAccepted to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EngineVersionRejectedError);
      expect((error as EngineVersionRejectedError).reason).toBe("malformed");
    }
  });
});

describe("baseline-sync — docs/engine-baseline.md must agree with these constants", () => {
  const baselineText = readFileSync(BASELINE_DOC_PATH, "utf8");

  it("the document's headline 'Accepted range' statement matches ACCEPTED_ENGINE_VERSION_RANGE", () => {
    const expected = `${ACCEPTED_ENGINE_VERSION_RANGE.min}–${ACCEPTED_ENGINE_VERSION_RANGE.max}`;
    expect(baselineText).toContain(`Accepted range:** **${expected}**`);
  });

  it("§10's engine-version-drift bullet matches ACCEPTED_ENGINE_VERSION_RANGE", () => {
    const expected = `${ACCEPTED_ENGINE_VERSION_RANGE.min}–${ACCEPTED_ENGINE_VERSION_RANGE.max}`;
    expect(baselineText).toContain(`claude --version\` moves outside ${expected}`);
  });

  it("§10's SDK-version-drift bullet matches ACCEPTED_SDK_VERSION_RANGE", () => {
    const expected = `${ACCEPTED_SDK_VERSION_RANGE.min}–${ACCEPTED_SDK_VERSION_RANGE.max}`;
    expect(baselineText).toContain(`moves outside ${expected}`);
  });

  it("the document's 'Tested version' statement matches TESTED_ENGINE_VERSION", () => {
    expect(baselineText).toContain(`claude\` CLI **${TESTED_ENGINE_VERSION}**`);
  });
});
