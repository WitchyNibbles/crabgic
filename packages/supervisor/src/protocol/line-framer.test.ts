import { describe, expect, it } from "vitest";
import { createLineFramer, MAX_LINE_BYTES, LineTooLongError } from "./line-framer.js";

describe("createLineFramer", () => {
  it("yields nothing until a newline arrives", () => {
    const framer = createLineFramer();
    expect(framer.push("partial-no-newline")).toEqual([]);
    expect(framer.pending).toBe("partial-no-newline");
  });

  it("yields one line per push when a full line arrives at once", () => {
    const framer = createLineFramer();
    expect(framer.push("line-one\n")).toEqual(["line-one"]);
    expect(framer.pending).toBe("");
  });

  it("yields multiple lines from a single chunk containing several newlines", () => {
    const framer = createLineFramer();
    expect(framer.push("a\nb\nc\n")).toEqual(["a", "b", "c"]);
  });

  it("holds back a trailing partial line across pushes, then completes it", () => {
    const framer = createLineFramer();
    expect(framer.push("hel")).toEqual([]);
    expect(framer.push("lo\nworld")).toEqual(["hello"]);
    expect(framer.pending).toBe("world");
    expect(framer.push("!\n")).toEqual(["world!"]);
  });

  it("handles an arbitrary byte-by-byte split without losing or duplicating any line", () => {
    const framer = createLineFramer();
    const input = "one\ntwo\nthree\n";
    const collected: string[] = [];
    for (const ch of input) {
      collected.push(...framer.push(ch));
    }
    expect(collected).toEqual(["one", "two", "three"]);
  });

  it("accepts Buffer chunks identically to string chunks", () => {
    const framer = createLineFramer();
    expect(framer.push(Buffer.from("buf-line\n", "utf8"))).toEqual(["buf-line"]);
  });

  describe("MAX_LINE_BYTES cap — defensive bound against an unbounded newline-less stream", () => {
    it("a line exactly at the cap, newline-terminated, still parses fine", () => {
      const framer = createLineFramer();
      const atCap = "a".repeat(MAX_LINE_BYTES);
      expect(framer.push(`${atCap}\n`)).toEqual([atCap]);
      expect(framer.pending).toBe("");
    });

    it("a pending (never-newline-terminated) buffer exactly at the cap does not throw", () => {
      const framer = createLineFramer();
      const atCap = "b".repeat(MAX_LINE_BYTES);
      expect(framer.push(atCap)).toEqual([]);
      expect(framer.pending).toBe(atCap);
    });

    it("throws LineTooLongError once a never-newline-terminated pending buffer exceeds the cap", () => {
      const framer = createLineFramer();
      const overCap = "c".repeat(MAX_LINE_BYTES + 1);
      expect(() => framer.push(overCap)).toThrow(LineTooLongError);
    });

    it("throws LineTooLongError when the cap is exceeded cumulatively across multiple pushes, none individually over it", () => {
      const framer = createLineFramer();
      const half = "d".repeat(Math.ceil(MAX_LINE_BYTES / 2) + 1);
      expect(framer.push(half)).toEqual([]); // under the cap alone
      expect(() => framer.push(half)).toThrow(LineTooLongError); // combined, now over
    });

    it("throws LineTooLongError for a single completed (newline-terminated) line that itself exceeds the cap, even delivered in one chunk", () => {
      const framer = createLineFramer();
      const overCap = "e".repeat(MAX_LINE_BYTES + 1);
      expect(() => framer.push(`${overCap}\n`)).toThrow(LineTooLongError);
    });

    it("normal, well-framed messages well under the cap continue to parse correctly after the cap logic is exercised", () => {
      const framer = createLineFramer();
      expect(framer.push("small-line-1\nsmall-line-2\n")).toEqual(["small-line-1", "small-line-2"]);
    });
  });
});
