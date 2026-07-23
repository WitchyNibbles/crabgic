import { describe, expect, it } from "vitest";
import { CliUsageError } from "../errors.js";
import { readBooleanFlag, readValueFlag, suppliedFlagNames, tokenize } from "./tokenize.js";

describe("tokenize", () => {
  it("splits positionals from --flag/--flag=value/--flag value forms", () => {
    const t = tokenize(["a", "--bare", "--eq=val", "--spaced", "spacedval", "b"], ["spaced"]);
    expect(t.positionals).toEqual(["a", "b"]);
    expect(t.flags.get("bare")).toBe(true);
    expect(t.flags.get("eq")).toBe("val");
    expect(t.flags.get("spaced")).toBe("spacedval");
  });

  it("rejects a malformed --=value flag (empty name before =)", () => {
    expect(() => tokenize(["--=oops"])).toThrow(CliUsageError);
  });

  it("rejects a bare -- with nothing after it", () => {
    expect(() => tokenize(["--"])).toThrow(CliUsageError);
  });

  it("throws when a value-flag is the last token with no following value", () => {
    expect(() => tokenize(["--token"], ["token"])).toThrow(CliUsageError);
  });

  it("throws when a value-flag is immediately followed by another flag", () => {
    expect(() => tokenize(["--token", "--other"], ["token"])).toThrow(CliUsageError);
  });

  it("last write wins for a repeated flag", () => {
    const t = tokenize(["--x=1", "--x=2"]);
    expect(t.flags.get("x")).toBe("2");
  });
});

describe("readBooleanFlag", () => {
  it("is false when absent", () => {
    expect(readBooleanFlag(tokenize([]), "watch")).toBe(false);
  });
  it("is true for a bare flag", () => {
    expect(readBooleanFlag(tokenize(["--watch"]), "watch")).toBe(true);
  });
  it("throws if supplied with a value", () => {
    expect(() => readBooleanFlag(tokenize(["--watch=true"]), "watch")).toThrow(CliUsageError);
  });
});

describe("readValueFlag", () => {
  it("is undefined when absent", () => {
    expect(readValueFlag(tokenize([]), "reference")).toBeUndefined();
  });
  it("returns the value", () => {
    expect(readValueFlag(tokenize(["--reference=env:X"]), "reference")).toBe("env:X");
  });
  it("throws if supplied bare with no value", () => {
    expect(() => readValueFlag(tokenize(["--reference"]), "reference")).toThrow(CliUsageError);
  });
});

describe("suppliedFlagNames", () => {
  it("lists every flag name actually supplied", () => {
    expect(suppliedFlagNames(tokenize(["--a", "--b=1"]))).toEqual(["a", "b"]);
  });
});
