import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { CandidateSource } from "./types.js";
import { computeCandidateDigest } from "./digest.js";

function candidate(overrides: Partial<CandidateSource> = {}): CandidateSource {
  return {
    kind: "skill",
    name: "example-skill",
    files: [{ path: "SKILL.md", content: "# Example\n" }],
    permissionFootprint: ["Read(./**)"],
    ...overrides,
  };
}

describe("computeCandidateDigest", () => {
  it("two audits of a byte-identical candidate yield the identical digest (reproducibility exit criterion)", () => {
    const a = computeCandidateDigest(candidate());
    const b = computeCandidateDigest(candidate());
    expect(a).toBe(b);
  });

  it("is independent of file array order", () => {
    const c1 = candidate({
      files: [
        { path: "a.md", content: "A" },
        { path: "b.md", content: "B" },
      ],
    });
    const c2 = candidate({
      files: [
        { path: "b.md", content: "B" },
        { path: "a.md", content: "A" },
      ],
    });
    expect(computeCandidateDigest(c1)).toBe(computeCandidateDigest(c2));
  });

  it("is independent of permissionFootprint array order", () => {
    const c1 = candidate({ permissionFootprint: ["Read(./**)", "Bash(git *)"] });
    const c2 = candidate({ permissionFootprint: ["Bash(git *)", "Read(./**)"] });
    expect(computeCandidateDigest(c1)).toBe(computeCandidateDigest(c2));
  });

  it("changes when file content changes", () => {
    const a = computeCandidateDigest(candidate());
    const b = computeCandidateDigest(
      candidate({ files: [{ path: "SKILL.md", content: "# Example (edited)\n" }] }),
    );
    expect(a).not.toBe(b);
  });

  it("changes when the executable bit changes with identical content", () => {
    const a = computeCandidateDigest(
      candidate({ files: [{ path: "run.sh", content: "echo hi", executable: false }] }),
    );
    const b = computeCandidateDigest(
      candidate({ files: [{ path: "run.sh", content: "echo hi", executable: true }] }),
    );
    expect(a).not.toBe(b);
  });

  it("never depends on provenance (a re-signed, otherwise-identical candidate pins to the same digest)", () => {
    const a = computeCandidateDigest(candidate({ provenance: { signature: "sig-1" } }));
    const b = computeCandidateDigest(candidate({ provenance: { signature: "sig-2" } }));
    expect(a).toBe(b);
  });

  it("property: mutating any file's content forces a different digest across randomized candidates", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.string({ minLength: 1, maxLength: 40 }),
        (contentA, contentB) => {
          fc.pre(contentA !== contentB);
          const c1 = candidate({ files: [{ path: "x.md", content: contentA }] });
          const c2 = candidate({ files: [{ path: "x.md", content: contentB }] });
          expect(computeCandidateDigest(c1)).not.toBe(computeCandidateDigest(c2));
        },
      ),
      { numRuns: 100 },
    );
  });
});
