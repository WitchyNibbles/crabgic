import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  isActionSupportedForDcEdition,
  normalizeDcEdition,
  resolveDcEditionFeatures,
} from "./dc-edition-feature-matrix.js";

/**
 * roadmap/19-jira-datacenter-adapter.md work item 3, entry point: "a query
 * against an unrecognized edition/version asserts typed `unsupported`
 * BEFORE the matrix has any entries to consult (i.e. the safe-default
 * path is proven before real data lands)." This suite is written first —
 * `./dc-edition-feature-matrix.ts` does not exist yet.
 */
describe("resolveDcEditionFeatures", () => {
  it("resolves the 10.3 edition entry", () => {
    const entry = resolveDcEditionFeatures("10.3");
    expect(entry).toBeDefined();
    expect(entry?.edition).toBe("10.3");
  });

  it("resolves the 11.3 edition entry", () => {
    const entry = resolveDcEditionFeatures("11.3");
    expect(entry).toBeDefined();
    expect(entry?.edition).toBe("11.3");
  });

  it("returns undefined (never a guess) for an unrecognized edition", () => {
    expect(resolveDcEditionFeatures("9.0")).toBeUndefined();
    expect(resolveDcEditionFeatures("unknown")).toBeUndefined();
    expect(resolveDcEditionFeatures("")).toBeUndefined();
  });
});

describe("normalizeDcEdition", () => {
  it("matches a full version string to its known edition prefix", () => {
    expect(normalizeDcEdition("10.3.1")).toBe("10.3");
    expect(normalizeDcEdition("11.3.0")).toBe("11.3");
  });

  it("returns 'unknown' (never a guess) for an unrecognized version", () => {
    expect(normalizeDcEdition("8.20.1")).toBe("unknown");
    expect(normalizeDcEdition("")).toBe("unknown");
    expect(normalizeDcEdition("garbage")).toBe("unknown");
  });
});

describe("isActionSupportedForDcEdition", () => {
  it("returns true for a known action on a known edition", () => {
    expect(isActionSupportedForDcEdition("10.3", "issue.create")).toBe(true);
    expect(isActionSupportedForDcEdition("11.3", "issue.create")).toBe(true);
  });

  it("returns false (never a guess, never a raw-endpoint fallback) for ANY action on an unrecognized edition", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (edition, action) => {
        if (resolveDcEditionFeatures(edition) === undefined) {
          expect(isActionSupportedForDcEdition(edition, action as never)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("never emits a guessed action for a fuzzed action string on a known edition unless it is actually listed", () => {
    fc.assert(
      fc.property(fc.string(), (action) => {
        const entry = resolveDcEditionFeatures("10.3");
        const expected = entry !== undefined && entry.availableActions.includes(action as never);
        expect(isActionSupportedForDcEdition("10.3", action as never)).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });
});
