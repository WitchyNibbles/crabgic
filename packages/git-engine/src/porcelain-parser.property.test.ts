import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parsePorcelainV2 } from "./porcelain-parser.js";

/**
 * WI4 Property test — roadmap/07-git-control-repo-worktrees.md Test plan:
 * "porcelain-snapshot parser determinism — re-parsing an identical
 * status-v2 byte stream twice always yields byte-identical structured
 * output." ≥1000 fast-check cases over randomly generated (but
 * grammar-valid) porcelain-v2 byte streams.
 */

const HASH_A = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
const HASH_B = "1111111111111111111111111111111111111111";

const safePathArb = fc
  .stringMatching(/^[a-zA-Z0-9_/-]{1,20}$/)
  .filter((s) => s.length > 0 && !s.startsWith("/") && !s.endsWith("/"));

const modifiedLineArb = safePathArb.map(
  (p) => `1 .M N... 100644 100644 100644 ${HASH_A} ${HASH_B} ${p}`,
);
const addedLineArb = safePathArb.map(
  (p) => `1 A. N... 000000 100644 100644 0000000000000000000000000000000000000000 ${HASH_B} ${p}`,
);
const deletedLineArb = safePathArb.map(
  (p) => `1 D. N... 100644 000000 000000 ${HASH_A} 0000000000000000000000000000000000000000 ${p}`,
);
const renamedLineArb = fc
  .tuple(safePathArb, safePathArb)
  .map(([a, b]) => `2 R100 N... 100644 100644 100644 ${HASH_A} ${HASH_B} R100 ${a}\t${b}`);
const untrackedLineArb = safePathArb.map((p) => `? ${p}`);
const ignoredLineArb = safePathArb.map((p) => `! ${p}`);
const headerLineArb = fc.constantFrom("# branch.oid deadbeef", "# branch.head main");

const lineArb = fc.oneof(
  modifiedLineArb,
  addedLineArb,
  deletedLineArb,
  renamedLineArb,
  untrackedLineArb,
  ignoredLineArb,
  headerLineArb,
);

const porcelainTextArb = fc
  .array(lineArb, { minLength: 0, maxLength: 30 })
  .map((lines) => lines.join("\n"));

describe("parsePorcelainV2 — determinism property (WI4)", () => {
  it("re-parsing an identical byte stream twice always yields byte-identical structured output", () => {
    fc.assert(
      fc.property(porcelainTextArb, (text) => {
        const first = parsePorcelainV2(text);
        const second = parsePorcelainV2(text);
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      }),
      { numRuns: 1000 },
    );
  });

  it("parsing is a pure function of its input (unrelated prior calls never leak state)", () => {
    fc.assert(
      fc.property(porcelainTextArb, porcelainTextArb, (textA, textB) => {
        const before = parsePorcelainV2(textA);
        parsePorcelainV2(textB);
        const after = parsePorcelainV2(textA);
        expect(JSON.stringify(after)).toBe(JSON.stringify(before));
      }),
      { numRuns: 1000 },
    );
  });
});
