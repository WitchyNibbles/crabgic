import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Structural proof (mirrors the `gateway-name-reference.test.ts`/
 * `secret-redaction.test.ts` "scan this package's own source" convention
 * already used elsewhere in this repo): `run-drift-ci.ts` never imports or
 * calls any filesystem-write primitive directly — its ONLY two
 * side-effecting capabilities are the `saveDebounceState`/`writeProposals`
 * functions the CALLER injects via `RunDriftCiDeps`. This is what makes
 * "zero pinned-fixture/config changes applied by the job itself" true by
 * construction, not merely by the unit test's own fake-deps assertions.
 */
const SOURCE_PATH = join(dirname(fileURLToPath(import.meta.url)), "run-drift-ci.ts");

const FORBIDDEN_WRITE_PATTERNS: readonly RegExp[] = [
  /writeFile/,
  /writeFileSync/,
  /from ["']node:fs["']/,
  /require\(["']fs["']\)/,
  /import \* as fs/,
];

describe("run-drift-ci.ts never imports/calls a filesystem-write primitive directly", () => {
  it("contains no forbidden write-shaped reference anywhere in its own source", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    for (const pattern of FORBIDDEN_WRITE_PATTERNS) {
      expect(source).not.toMatch(pattern);
    }
  });
});
