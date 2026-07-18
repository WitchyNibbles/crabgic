/**
 * Gap 1 conformance test — roadmap/05-supervisor-daemon.md §Test plan,
 * Conformance: "a grep-based check over this package's registered router/
 * registry operation names confirms no `change_set.*`-named operation
 * exists anywhere in it (Gap 1 — ChangeSet-state queries are answered
 * exclusively by 11's `project.inspect`, mirrors 22's grep-based check over
 * `packages/gateway`'s registered tool names)."
 *
 * Two independent checks: (1) the router's own live, registered operation
 * vocabulary (`SUPERVISOR_OPERATIONS`, the same array `operations.ts`
 * feeds into every `router.register(...)` call) never contains a
 * `change_set.`-prefixed name; (2) a repo-wide, raw-text scan of every
 * source (non-test) `.ts` file under this package never contains the
 * literal string `"change_set."` at all — catching a stray future addition
 * anywhere in this package, not just in the one file that currently lists
 * the vocabulary (mirrors `packages/contracts/src/gateway/server-name.ts`'s
 * own sole-definition-site scanner pattern: a raw-text `.split()` over
 * every `.ts` file, not an AST-aware scan, so a hit inside a comment counts
 * too — the same conservative choice that caught a stray literal inside a
 * doc-comment during phase 02's own integration pass).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SUPERVISOR_OPERATIONS } from "./operations.js";

const SRC_ROOT = fileURLToPath(new URL("../..", import.meta.url)) + "src";

function listTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("Gap 1 conformance — no change_set.* operation anywhere in @eo/supervisor", () => {
  it("SUPERVISOR_OPERATIONS (the router's own registered vocabulary) contains no change_set.*-prefixed name", () => {
    for (const op of SUPERVISOR_OPERATIONS) {
      expect(op.startsWith("change_set.")).toBe(false);
    }
  });

  it('no source (non-test) .ts file under packages/supervisor/src contains the literal string "change_set."', () => {
    const files = listTsFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (content.includes("change_set.")) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
