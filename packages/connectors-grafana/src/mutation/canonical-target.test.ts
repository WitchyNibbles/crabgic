import { describe, expect, it } from "vitest";
import { buildCanonicalTarget, parseCanonicalTarget } from "./canonical-target.js";

describe("buildCanonicalTarget / parseCanonicalTarget", () => {
  it("round-trips kind + id", () => {
    const target = buildCanonicalTarget("folder", "fold-1");
    expect(target).toBe("folder:fold-1");
    expect(parseCanonicalTarget(target)).toEqual({ kind: "folder", id: "fold-1" });
  });

  it("an id containing a colon is preserved in full (split on the FIRST colon only)", () => {
    const target = buildCanonicalTarget("annotation", "abc:def");
    expect(parseCanonicalTarget(target)).toEqual({ kind: "annotation", id: "abc:def" });
  });

  it("throws when there is no separator at all", () => {
    expect(() => parseCanonicalTarget("no-separator-here")).toThrow(/malformed/);
  });

  it("throws for an unrecognized resource kind", () => {
    expect(() => parseCanonicalTarget("data-source:x")).toThrow(/unrecognized/);
  });

  it("throws for an empty id", () => {
    expect(() => parseCanonicalTarget("folder:")).toThrow(/empty id/);
  });
});
