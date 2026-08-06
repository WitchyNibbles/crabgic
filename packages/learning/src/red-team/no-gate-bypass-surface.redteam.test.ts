import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `@learning-redteam` — roadmap/22-learning-system.md §Exit criteria:
 * "Project-scoped promotion produces a real `ChangeSet` that clears the same
 * gates (14) as any other change before publish (08) — integration test on
 * fake engine PROVES NO BYPASS PATH EXISTS."
 *
 * `./no-bypass.redteam.test.ts` proves the positive half: a promoted lesson's
 * `ChangeSet` really is fired through `@crabgic/gates`' own
 * `createGateRegistry()`/`fireAll`, failing gate and all. The "no bypass path
 * exists" half rested on that file's own DOC COMMENT ("grep confirms zero
 * occurrences …") — true when re-run independently, but a sentence, not a
 * check. This file turns it into one, in the idiom
 * `packages/git-engine/src/spawn-surface-scan.test.ts` already established
 * for a static absence-enforcement.
 *
 * SCOPE, decided by measurement rather than by preference. The stronger form
 * — "no non-test source imports `@crabgic/gates` at all" — was written,
 * measured, and REJECTED: at `c0b3873`,
 * `git grep '@crabgic/gates' -- packages/learning/src` (tests excluded)
 * returns 7 hits, of which `../eval/eval-runner.ts:2` is a real import of
 * `findEvidenceForRequirement`. That import is a READ of recorded gate
 * evidence, which roadmap/22 §In scope explicitly requires ("dev/held-out
 * grading is executed against P14's gate framework and `EvidenceRecord`s as
 * ground truth"). Banning the package import would therefore misstate the
 * boundary the criterion draws. What the criterion forbids is this package
 * FIRING or wrapping gates, so the scan bans exactly the firing surface:
 * `createGateRegistry` / `fireAll` / `fireByTag`.
 */
const LEARNING_SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
const SELF_PATH = fileURLToPath(import.meta.url);

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") continue;
      files.push(...listSourceFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

// Test files are excluded because `./no-bypass.redteam.test.ts` legitimately
// fires the real registry — that IS the positive proof. `SELF_PATH` is
// excluded because this scanner's own pattern literals would otherwise trip
// its detectors (scanning the scanner is not a finding).
const ALL_SOURCE_FILES = listSourceFiles(LEARNING_SRC_DIR).filter(
  (f) => f !== SELF_PATH && !f.endsWith(".test.ts"),
);

describe("@learning-redteam no gate-bypass surface — the absence the no-bypass proof rests on, enforced rather than asserted", () => {
  it("this scanner's target directory actually resolves and holds a non-trivial file count (the scan is not vacuous)", () => {
    expect(statSync(LEARNING_SRC_DIR).isDirectory()).toBe(true);
    expect(ALL_SOURCE_FILES.length).toBeGreaterThan(5);
  });

  it("no non-test source under packages/learning/src references createGateRegistry / fireAll / fireByTag", () => {
    const firingSurface = /\bcreateGateRegistry\b|\bfireAll\b|\bfireByTag\b/;
    const offenders: string[] = [];
    for (const file of ALL_SOURCE_FILES) {
      // Tests the file's CONTENT, never a single line: a multi-line import
      // would slip past a per-line pattern.
      if (firingSurface.test(readFileSync(file, "utf8"))) {
        offenders.push(relative(LEARNING_SRC_DIR, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
