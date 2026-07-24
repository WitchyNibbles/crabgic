import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeContentDigest, listPackagedFiles } from "./content-digest.js";
import { resolvePluginRoot } from "./plugin-root.js";

const dirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "eo-content-digest-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function seedFixture(dir: string): void {
  mkdirSync(join(dir, "skills"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true }); // must be excluded
  writeFileSync(join(dir, "skills", "run.md"), "hello\n");
  writeFileSync(join(dir, "package.json"), "{}"); // must be excluded
  writeFileSync(join(dir, "src", "index.ts"), "export {};"); // must be excluded
}

describe("listPackagedFiles", () => {
  it("excludes src/, dist/, node_modules/, package.json, tsconfig.json, and .claude-plugin/", () => {
    const dir = makeTmpDir();
    seedFixture(dir);
    const files = listPackagedFiles(dir);
    expect(files).toEqual(["skills/run.md"]);
  });

  it("returns a sorted, POSIX-separated relative path list", () => {
    const dir = makeTmpDir();
    mkdirSync(join(dir, "b"), { recursive: true });
    mkdirSync(join(dir, "a"), { recursive: true });
    writeFileSync(join(dir, "b", "z.md"), "z");
    writeFileSync(join(dir, "a", "y.md"), "y");
    expect(listPackagedFiles(dir)).toEqual(["a/y.md", "b/z.md"]);
  });
});

describe("computeContentDigest", () => {
  it("is deterministic for identical content", () => {
    const dirA = makeTmpDir();
    const dirB = makeTmpDir();
    seedFixture(dirA);
    seedFixture(dirB);
    expect(computeContentDigest(dirA)).toBe(computeContentDigest(dirB));
  });

  it("changes when any packaged file's content changes", () => {
    const dir = makeTmpDir();
    seedFixture(dir);
    const before = computeContentDigest(dir);
    writeFileSync(join(dir, "skills", "run.md"), "hello, mutated\n");
    expect(computeContentDigest(dir)).not.toBe(before);
  });

  it("is stable across CRLF/LF line-ending normalization", () => {
    const dirLf = makeTmpDir();
    const dirCrlf = makeTmpDir();
    mkdirSync(join(dirLf, "skills"), { recursive: true });
    mkdirSync(join(dirCrlf, "skills"), { recursive: true });
    writeFileSync(join(dirLf, "skills", "run.md"), "line1\nline2\n");
    writeFileSync(join(dirCrlf, "skills", "run.md"), "line1\r\nline2\r\n");
    expect(computeContentDigest(dirLf)).toBe(computeContentDigest(dirCrlf));
  });

  it("is unaffected by excluded files changing", () => {
    const dir = makeTmpDir();
    seedFixture(dir);
    const before = computeContentDigest(dir);
    writeFileSync(join(dir, "src", "index.ts"), "export const x = 1;");
    expect(computeContentDigest(dir)).toBe(before);
  });

  it("computes a real, non-empty digest for this package's own real artifacts", () => {
    const digest = computeContentDigest(resolvePluginRoot());
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
