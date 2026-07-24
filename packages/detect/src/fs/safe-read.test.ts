import { afterEach, describe, expect, it } from "vitest";
import { freshTmpDir, removeDirTree, writeFixtureFile } from "../test-support/fixture-repo.js";
import { parseJsonSafe, readTextBounded } from "./safe-read.js";

describe("readTextBounded", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) removeDirTree(d);
  });
  function newRoot(): string {
    const dir = freshTmpDir();
    dirs.push(dir);
    return dir;
  }

  it("reads a small text file fully", () => {
    const root = newRoot();
    const path = writeFixtureFile(root, "a.txt", "hello world");
    expect(readTextBounded(path)).toBe("hello world");
  });

  it("returns undefined for a missing path rather than throwing", () => {
    expect(readTextBounded("/nonexistent-eo-detect-safe-read")).toBeUndefined();
  });

  it("returns undefined for a directory path", () => {
    const root = newRoot();
    expect(readTextBounded(root)).toBeUndefined();
  });

  it("returns undefined for a file larger than the configured byte cap, never partially executes/parses it", () => {
    const root = newRoot();
    const path = writeFixtureFile(root, "big.txt", "x".repeat(100));
    expect(readTextBounded(path, 10)).toBeUndefined();
  });
});

describe("parseJsonSafe", () => {
  it("parses valid JSON", () => {
    expect(parseJsonSafe('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns undefined for malformed JSON rather than throwing", () => {
    expect(parseJsonSafe("{not json")).toBeUndefined();
  });
});
