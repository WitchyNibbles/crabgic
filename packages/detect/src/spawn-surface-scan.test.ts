import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Structural / static no-exec guard, package-wide — roadmap/12 §Goal:
 * "`StackEvidence` is always derived from static analysis with zero
 * child-process spawns," reinforced by the "malicious postinstall" seeded
 * threat (§Test plan, "Security" bullet) needing a guarantee that
 * survives even a future detector regression. Mirrors
 * `packages/git-engine/src/spawn-surface-scan.test.ts`'s own convention: a
 * real, non-test-absence scan of every non-test source file's text for the
 * exact patterns a subprocess spawn or shell-routed invocation would leave
 * behind. This is a repo-wide guarantee for the WHOLE package — not just
 * `./detectors/`, `./evidence-builder.ts`, `./fs/` — because the quarantine
 * pipeline's sandbox-test stage (`./quarantine/sandbox/`) is explicitly a
 * SIMULATED stand-in (no real `@anthropic-ai/sandbox-runtime` dependency
 * available yet — see that directory's own doc comment) and must never
 * silently regress into a real, unguarded subprocess launch either.
 */

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const SELF_PATH = fileURLToPath(import.meta.url);
const NO_EXEC_JAIL_TEST_PATH = join(SRC_DIR, "no-exec-jail.test.ts");

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") continue;
      files.push(...listSourceFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".mjs")) {
      files.push(full);
    }
  }
  return files;
}

// Excludes THIS scanner file (its own pattern literals would trip its own
// detectors) and `no-exec-jail.test.ts` (which legitimately imports/wraps
// `node:child_process` real exports to prove the ABSENCE of calls — see
// that file's own doc comment).
const ALL_SOURCE_FILES = listSourceFiles(SRC_DIR).filter(
  (f) => f !== SELF_PATH && f !== NO_EXEC_JAIL_TEST_PATH,
);

describe("spawn-surface static scan (no-exec-jail exit criterion)", () => {
  it("no file imports node:child_process (or the bare specifier `child_process`)", () => {
    const offenders: string[] = [];
    for (const file of ALL_SOURCE_FILES) {
      const text = readFileSync(file, "utf8");
      if (
        /from\s+["']node:child_process["']/.test(text) ||
        /from\s+["']child_process["']/.test(text)
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("zero occurrences of shell:true / shell: true anywhere in this package's source", () => {
    const offenders: string[] = [];
    for (const file of ALL_SOURCE_FILES) {
      const text = readFileSync(file, "utf8");
      if (/shell\s*:\s*true/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("zero calls to spawn/exec/execFile/fork (sync or async) anywhere in this package's source", () => {
    const offenders: string[] = [];
    const pattern = /(?<![A-Za-z0-9_.])(spawn|exec|execFile|fork)(Sync)?\s*\(/;
    for (const file of ALL_SOURCE_FILES) {
      const text = readFileSync(file, "utf8");
      if (pattern.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("this scan itself covers a non-trivial number of source files (sanity guard against an empty/broken glob)", () => {
    expect(ALL_SOURCE_FILES.length).toBeGreaterThan(10);
  });
});
