import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  draftChangelog,
  isPlaceholderChangelogDraft,
  parseChangesetFile,
  readChangesetEntries,
} from "./changelogDraftPreparer.js";

const execFileAsync = promisify(execFile);

describe("parseChangesetFile — unit", () => {
  it("parses a well-formed single-package changeset", () => {
    const content = '---\n"crabgic": major\n---\n\nInitial v1.0.0 release.\n';
    const entry = parseChangesetFile("fixture.md", content);
    expect(entry).toEqual({
      filename: "fixture.md",
      packages: [{ packageName: "crabgic", bump: "major" }],
      summary: "Initial v1.0.0 release.",
    });
  });

  it("parses a multi-package changeset", () => {
    const content =
      '---\n"@crabgic/contracts": patch\n"@crabgic/journal": minor\n---\n\nFix + feature.\n';
    const entry = parseChangesetFile("fixture.md", content);
    expect(entry?.packages).toEqual([
      { packageName: "@crabgic/contracts", bump: "patch" },
      { packageName: "@crabgic/journal", bump: "minor" },
    ]);
  });

  it("returns undefined for content with no frontmatter at all (e.g. README.md)", () => {
    expect(parseChangesetFile("README.md", "# Changesets\n\nHello!\n")).toBeUndefined();
  });

  it("skips a blank line inside the frontmatter and ignores a non-bump frontmatter line", () => {
    const content = '---\n\n"crabgic": patch\nsome-other-key: ignored\n---\n\nBody.\n';
    const entry = parseChangesetFile("fixture.md", content);
    expect(entry?.packages).toEqual([{ packageName: "crabgic", bump: "patch" }]);
  });
});

describe("readChangesetEntries — unit (fixture directory)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eo-changeset-fixture-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads every .md changeset, skipping README.md", async () => {
    await writeFile(join(dir, "README.md"), "# Changesets\n");
    await writeFile(join(dir, "one-fish.md"), '---\n"crabgic": major\n---\n\nFirst change.\n');
    await writeFile(join(dir, "two-fish.md"), '---\n"crabgic": patch\n---\n\nSecond change.\n');
    const entries = readChangesetEntries(dir);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.summary).sort()).toEqual(["First change.", "Second change."]);
  });

  it("returns [] for a directory with only README.md", async () => {
    await writeFile(join(dir, "README.md"), "# Changesets\n");
    expect(readChangesetEntries(dir)).toEqual([]);
  });

  it("skips a stray .md file with no changesets frontmatter (not named README.md)", async () => {
    await writeFile(join(dir, "notes.md"), "# Just some notes, no frontmatter\n");
    await writeFile(join(dir, "real-one.md"), '---\n"crabgic": patch\n---\n\nReal change.\n');
    const entries = readChangesetEntries(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.summary).toBe("Real change.");
  });

  it("returns [] (never throws) for a nonexistent directory", () => {
    expect(readChangesetEntries(join(dir, "does-not-exist"))).toEqual([]);
  });
});

describe("draftChangelog — unit", () => {
  it("drafts a header-only placeholder when there are zero changeset entries", () => {
    const draft = draftChangelog({
      version: "1.0.0",
      entries: [],
      releaseDate: () => "2026-07-24",
    });
    expect(draft).toContain("## 1.0.0 (2026-07-24)");
    expect(draft).toContain("No `.changeset/*.md` entries were recorded");
  });

  it("drafts real bullet points from real changeset entries", () => {
    const draft = draftChangelog({
      version: "1.0.0",
      releaseDate: () => "2026-07-24",
      entries: [
        {
          filename: "one.md",
          packages: [{ packageName: "crabgic", bump: "major" }],
          summary: "Initial v1.0.0 release.",
        },
      ],
    });
    expect(draft).toContain("## 1.0.0 (2026-07-24)");
    expect(draft).toContain("Initial v1.0.0 release. (crabgic: major)");
  });

  it("skips a changeset entry with an empty summary rather than emitting a blank bullet", () => {
    const draft = draftChangelog({
      version: "1.0.0",
      releaseDate: () => "2026-07-24",
      entries: [{ filename: "empty.md", packages: [], summary: "" }],
    });
    expect(draft).not.toContain("- ");
  });
});

describe("readChangesetEntries + draftChangelog — genuine integration (this repo's own real .changeset/ directory)", () => {
  /**
   * This assertion deliberately covers BOTH states of the real directory
   * rather than pinning the one that happened to hold when it was written.
   *
   * It originally asserted `entries` was exactly `[]` — "zero real changesets
   * recorded yet". That is a snapshot of a moment, not an invariant: the
   * moment anyone does the right thing and records a changeset for a feature,
   * a green suite turns red for a reason that has nothing to do with the code
   * under test. (It did, on the status-line change.) What this test is really
   * for is that `readChangesetEntries` reads THIS repo's own directory and
   * `draftChangelog` turns whatever it finds into a coherent draft — and that
   * holds either way, so that is what is asserted.
   */
  it("drafts from whatever is really recorded in .changeset/, in either state", async () => {
    const repoRoot = (
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname })
    ).stdout.trim();
    const changesetDir = resolve(repoRoot, ".changeset");

    const entries = readChangesetEntries(changesetDir);
    const draft = draftChangelog({ version: "1.0.0", entries });
    expect(draft).toContain("## 1.0.0");

    if (entries.length === 0) {
      // Nothing recorded — the draft must say so rather than fabricate notes.
      expect(isPlaceholderChangelogDraft(draft)).toBe(true);
      return;
    }

    // Something recorded — every real entry reaches the draft, and the
    // placeholder sentence must not survive alongside real notes.
    expect(isPlaceholderChangelogDraft(draft)).toBe(false);
    for (const entry of entries) {
      if (entry.summary.length === 0) continue;
      // Summaries are newline-collapsed into a single bullet, so the first
      // line is what identifies the entry in the rendered draft.
      expect(draft).toContain(entry.summary.split("\n")[0]!.trim());
      for (const bump of entry.packages) {
        expect(draft).toContain(`${bump.packageName}: ${bump.bump}`);
      }
    }
  });

  it("ignores the changesets scaffolding, counting only real entries", async () => {
    const repoRoot = (
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname })
    ).stdout.trim();
    const entries = readChangesetEntries(resolve(repoRoot, ".changeset"));
    // `README.md` (scaffolded doc) and `config.json` (not markdown) are never
    // changesets, whatever else the directory happens to hold.
    expect(entries.map((e) => e.filename)).not.toContain("README.md");
    expect(entries.map((e) => e.filename)).not.toContain("config.json");
  });
});
