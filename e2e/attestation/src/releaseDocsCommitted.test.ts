import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_RELEASE_DOCS,
  checkReleaseDocsCommitted,
  extractCitedPaths,
  readReleaseDocsInput,
  type ReleaseDocInput,
} from "./releaseDocsCommitted.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** A doc satisfying every obligation — the baseline each seeded-defect fixture perturbs by exactly one field. */
function goodDoc(path: string): ReleaseDocInput {
  return {
    path,
    tracked: true,
    content: `# ${path}\n\nEvery claim cites its source: \`docs/engine-baseline.md\`.\n`,
  };
}

function allGoodDocs(): ReleaseDocInput[] {
  return REQUIRED_RELEASE_DOCS.map(goodDoc);
}

const ALWAYS_EXISTS = (): boolean => true;

describe("extractCitedPaths", () => {
  it("extracts repo-rooted backticked paths, de-duplicated and in first-seen order", () => {
    const content = "see `docs/a.md` and `packages/cli/package.json`, then `docs/a.md` again";
    expect(extractCitedPaths(content)).toEqual(["docs/a.md", "packages/cli/package.json"]);
  });

  it("ignores backticked tokens that are not repo-rooted paths", () => {
    // Versions, scoped package names, enum members and env-var paths are all
    // backticked in these docs but are not files this check can resolve.
    const content = "`0.3.218` `@eo/journal` `parked:rate_limit` `$XDG_STATE_HOME/eo` `README.md`";
    expect(extractCitedPaths(content)).toEqual([]);
  });

  it("ignores globs, which name a set rather than a file", () => {
    expect(extractCitedPaths("`docs/evidence/phase-*/README.md`")).toEqual([]);
  });

  it("strips a trailing slash so a cited directory still resolves", () => {
    expect(extractCitedPaths("`docker/grafana/11.6/`")).toEqual(["docker/grafana/11.6"]);
  });
});

describe("checkReleaseDocsCommitted — PASS", () => {
  it("passes when all four docs are tracked, cited, and every citation resolves", () => {
    const result = checkReleaseDocsCommitted({ docs: allGoodDocs(), pathExists: ALWAYS_EXISTS });
    expect(result.verdict).toBe("PASS");
    expect(result.reasons).toEqual([]);
    expect(result.details).toHaveLength(4);
  });
});

/**
 * Seeded fail-first vectors — one per obligation this exit criterion
 * states. Each perturbs exactly one field of an otherwise-passing fixture,
 * so a FAIL can only be attributable to the seeded defect.
 */
describe("checkReleaseDocsCommitted — seeded defects each FAIL", () => {
  it("FAILs when a required doc is absent entirely", () => {
    const docs = allGoodDocs().filter((doc) => doc.path !== "docs/upgrade-guide.md");
    const result = checkReleaseDocsCommitted({ docs, pathExists: ALWAYS_EXISTS });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("docs/upgrade-guide.md is absent");
  });

  it("FAILs when a doc exists on disk but is untracked — present is not committed", () => {
    const docs = allGoodDocs().map((doc) =>
      doc.path === "docs/security-posture.md" ? { ...doc, tracked: false } : doc,
    );
    const result = checkReleaseDocsCommitted({ docs, pathExists: ALWAYS_EXISTS });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("NOT git-tracked");
  });

  it("FAILs on an empty doc", () => {
    const docs = allGoodDocs().map((doc) =>
      doc.path === "docs/operator-guide.md" ? { ...doc, content: "   \n" } : doc,
    );
    const result = checkReleaseDocsCommitted({ docs, pathExists: ALWAYS_EXISTS });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("is empty");
  });

  it("FAILs on unfinished placeholder text, reporting the line", () => {
    const docs = allGoodDocs().map((doc) =>
      doc.path === "docs/compatibility-matrix.md"
        ? { ...doc, content: `# t\n\ncites \`docs/engine-baseline.md\`\n\nTODO: measure this\n` }
        : doc,
    );
    const result = checkReleaseDocsCommitted({ docs, pathExists: ALWAYS_EXISTS });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toMatch(/placeholder text.*line\(s\) 5/);
  });

  it("FAILs when a doc cites no repo-rooted source at all", () => {
    const docs = allGoodDocs().map((doc) =>
      doc.path === "docs/upgrade-guide.md"
        ? { ...doc, content: "# t\n\nUpgrades are safe and fast.\n" }
        : doc,
    );
    const result = checkReleaseDocsCommitted({ docs, pathExists: ALWAYS_EXISTS });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("cites no repo-rooted source");
  });

  it("FAILs on a dangling citation — the unverifiable-claim vector", () => {
    const result = checkReleaseDocsCommitted({
      docs: allGoodDocs(),
      pathExists: (path) => path !== "docs/engine-baseline.md",
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("do not exist in the release candidate");
  });

  it("never returns PASS for an empty document set", () => {
    const result = checkReleaseDocsCommitted({ docs: [], pathExists: ALWAYS_EXISTS });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

describe("readReleaseDocsInput — against the real repository", () => {
  it("finds all four release docs and reports each as git-tracked", () => {
    const input = readReleaseDocsInput(REPO_ROOT);
    expect(input.docs.map((doc) => doc.path).sort()).toEqual([...REQUIRED_RELEASE_DOCS].sort());
    for (const doc of input.docs) {
      expect(doc.tracked, `${doc.path} should be git-tracked`).toBe(true);
      expect(doc.content.length).toBeGreaterThan(0);
    }
  });

  it("resolves a path that exists and rejects one that does not", () => {
    const input = readReleaseDocsInput(REPO_ROOT);
    expect(input.pathExists("docs/engine-baseline.md")).toBe(true);
    expect(input.pathExists("docs/this-file-does-not-exist.md")).toBe(false);
  });

  /**
   * THE ENVIRONMENT-INDEPENDENCE GUARD. `pathExists` used `existsSync`, so a
   * citation to a generated-but-gitignored artifact resolved on any machine
   * that had run the generator and dangled in every fresh checkout. This check
   * therefore passed locally and failed on its first real CI run — the same
   * shape as the `.gitignore` P0 in e431710, where the tree built locally and
   * only locally.
   *
   * `e2e/release-gate-report.json` is the canonical instance: gitignored by
   * design, and the thing two release docs used to cite. Asserting on it
   * directly would be brittle once it is absent, so this writes its own
   * gitignored file and asserts that PRESENT-ON-DISK is not enough.
   */
  it("does not resolve a gitignored artifact, even when it is present on disk", () => {
    const generated = join(REPO_ROOT, "e2e", "release-gate-report.json");
    const preexisting = existsSync(generated);
    if (!preexisting) writeFileSync(generated, "{}\n", "utf-8");
    try {
      expect(existsSync(generated)).toBe(true);
      expect(readReleaseDocsInput(REPO_ROOT).pathExists("e2e/release-gate-report.json")).toBe(
        false,
      );
    } finally {
      if (!preexisting) rmSync(generated, { force: true });
    }
  });
});
