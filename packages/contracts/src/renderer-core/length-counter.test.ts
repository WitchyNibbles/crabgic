import { describe, expect, it } from "vitest";
import { countChars } from "./length-counter.js";

describe("countChars", () => {
  it("returns 0 for the empty string", () => {
    expect(countChars("")).toBe(0);
  });

  it("counts plain ASCII text (code units and code points coincide)", () => {
    expect(countChars("hello")).toBe(5);
  });

  it("counts a trailing newline as 1 char (line semantics live in line-counter.ts, not here)", () => {
    expect(countChars("hello\n")).toBe(6);
  });

  it("counts a surrogate-pair emoji as 1 char, not the 2 UTF-16 code units `.length` would report", () => {
    expect("\u{1F916}".length).toBe(2); // documents the UTF-16 code-unit count this function deliberately avoids
    expect(countChars("\u{1F916}")).toBe(1);
  });

  it("counts CRLF as 2 chars (no CRLF normalization happens at this layer)", () => {
    expect(countChars("a\r\nb")).toBe(4);
  });

  it("does not collapse a combining-mark grapheme cluster into 1 (documented limitation)", () => {
    // "e" + U+0301 COMBINING ACUTE ACCENT: two code points, one visual character.
    expect(countChars("é")).toBe(2);
  });
});
