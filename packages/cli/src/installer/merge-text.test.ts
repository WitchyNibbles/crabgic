import { describe, expect, it } from "vitest";
import {
  mergeManagedTextBlock,
  stripManagedTextBlock,
  MANAGED_BLOCK_BEGIN,
  MANAGED_BLOCK_END,
} from "./merge-text.js";

describe("mergeManagedTextBlock", () => {
  it("creates a brand-new file with just the managed block when there is no existing content", () => {
    const result = mergeManagedTextBlock(undefined, "hello");
    expect(result.changed).toBe(true);
    expect(result.content).toContain(MANAGED_BLOCK_BEGIN);
    expect(result.content).toContain("hello");
    expect(result.content).toContain(MANAGED_BLOCK_END);
  });

  it("appends the block, preserving all existing content, when no markers are present", () => {
    const existing = "# My project\n\nSome instructions.\n";
    const result = mergeManagedTextBlock(existing, "eo content");
    expect(result.changed).toBe(true);
    expect(result.content.startsWith(existing)).toBe(true);
    expect(result.content).toContain("eo content");
  });

  it("replaces ONLY the content between existing markers, preserving before/after verbatim", () => {
    const first = mergeManagedTextBlock("# User content\n", "v1").content;
    const second = mergeManagedTextBlock(first, "v2");
    expect(second.content).toContain("# User content");
    expect(second.content).toContain("v2");
    expect(second.content).not.toContain("v1");
  });

  it("is idempotent: re-merging identical desired content is a no-op (changed: false)", () => {
    const first = mergeManagedTextBlock("# User content\n", "same").content;
    const second = mergeManagedTextBlock(first, "same");
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first);
  });

  it("running the merge twice in a row (install run twice) diffs clean", () => {
    let content: string | undefined = "# Pre-existing\n";
    const r1 = mergeManagedTextBlock(content, "@AGENTS.md");
    content = r1.content;
    const r2 = mergeManagedTextBlock(content, "@AGENTS.md");
    expect(r2.changed).toBe(false);
  });

  it("preserves content both before AND after the markers", () => {
    const withBoth = `before\n${MANAGED_BLOCK_BEGIN}\nold\n${MANAGED_BLOCK_END}\nafter`;
    const result = mergeManagedTextBlock(withBoth, "new");
    expect(result.content).toContain("before");
    expect(result.content).toContain("after");
    expect(result.content).toContain("new");
    expect(result.content).not.toContain("old");
  });
});

describe("stripManagedTextBlock", () => {
  it("removes the managed block, restoring exactly the original pre-existing content (merge/strip round-trip)", () => {
    const original = "# User content\nMore user text.\n";
    const merged = mergeManagedTextBlock(original, "eo stuff").content;
    expect(stripManagedTextBlock(merged)).toBe(original);
  });

  it("leaves content with no markers at all untouched", () => {
    expect(stripManagedTextBlock("just some text")).toBe("just some text");
  });

  it("produces an empty string when the managed block was the file's only content", () => {
    const onlyBlock = mergeManagedTextBlock(undefined, "eo stuff").content;
    expect(stripManagedTextBlock(onlyBlock).trim()).toBe("");
  });
});
