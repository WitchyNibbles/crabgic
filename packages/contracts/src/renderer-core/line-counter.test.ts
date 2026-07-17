import { describe, expect, it } from "vitest";
import { countLines } from "./line-counter.js";

describe("countLines", () => {
  it("returns 0 for the empty string (no content is zero lines, not one blank line)", () => {
    expect(countLines("")).toBe(0);
  });

  it("returns 1 for single-line text with no newline", () => {
    expect(countLines("a")).toBe(1);
  });

  it("does not count a single trailing newline as an extra blank line", () => {
    expect(countLines("a\nb\n")).toBe(2);
  });

  it("counts an unterminated final line", () => {
    expect(countLines("a\nb")).toBe(2);
  });

  it("counts an interior blank line", () => {
    expect(countLines("a\n\nb")).toBe(3);
  });

  it("counts a lone newline as 1 line", () => {
    expect(countLines("\n")).toBe(1);
  });

  it("normalizes CRLF to LF before counting, so CRLF text never over-counts vs LF-only text", () => {
    expect(countLines("a\r\nb\r\n")).toBe(2);
    expect(countLines("a\r\nb")).toBe(2);
  });
});
