import { describe, expect, it } from "vitest";
import { computeLineDiff, renderUnifiedDiff } from "./diff-renderer.js";

describe("computeLineDiff", () => {
  it("reports pure context (no add/remove) for identical text", () => {
    const diff = computeLineDiff("a\nb\n", "a\nb\n");
    expect(diff.every((l) => l.kind === "context")).toBe(true);
  });

  it("reports an added line", () => {
    const diff = computeLineDiff("a\n", "a\nb\n");
    expect(diff.some((l) => l.kind === "add" && l.text === "b")).toBe(true);
  });

  it("reports a removed line", () => {
    const diff = computeLineDiff("a\nb\n", "a\n");
    expect(diff.some((l) => l.kind === "remove" && l.text === "b")).toBe(true);
  });

  it("reports both a removal and an addition for a changed line", () => {
    const diff = computeLineDiff("old line\n", "new line\n");
    expect(diff.some((l) => l.kind === "remove" && l.text === "old line")).toBe(true);
    expect(diff.some((l) => l.kind === "add" && l.text === "new line")).toBe(true);
  });
});

describe("renderUnifiedDiff", () => {
  it("prefixes added lines with + and removed lines with -", () => {
    const rendered = renderUnifiedDiff("a\n", "a\nb\n");
    expect(rendered).toContain("+b");
  });
});
