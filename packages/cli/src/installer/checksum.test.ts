import { describe, expect, it } from "vitest";
import { computeChecksum, normalizeForChecksum } from "./checksum.js";

describe("normalizeForChecksum", () => {
  it("converts CRLF to LF", () => {
    expect(normalizeForChecksum("a\r\nb\r\n")).toBe("a\nb\n");
  });

  it("leaves LF-only content untouched", () => {
    expect(normalizeForChecksum("a\nb\n")).toBe("a\nb\n");
  });
});

describe("computeChecksum", () => {
  it("is stable across CRLF/LF line-ending normalization", () => {
    expect(computeChecksum("a\nb\n")).toBe(computeChecksum("a\r\nb\r\n"));
  });

  it("changes when real content changes", () => {
    expect(computeChecksum("a\n")).not.toBe(computeChecksum("b\n"));
  });

  it("is a 64-char hex sha256 digest", () => {
    expect(computeChecksum("x")).toMatch(/^[a-f0-9]{64}$/);
  });
});
