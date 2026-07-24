import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  draftChangelog,
  parseChangesetFile,
  readChangesetEntries,
} from "./changelogDraftPreparer.js";

const execFileAsync = promisify(execFile);

describe("parseChangesetFile — unit", () => {
  it("parses a well-formed single-package changeset", () => {
    const content = '---\n"engineering-orchestrator": major\n---\n\nInitial v1.0.0 release.\n';
    const entry = parseChangesetFile("fixture.md", content);
    expect(entry).toEqual({
      filename: "fixture.md",
      packages: [{ packageName: "engineering-orchestrator", bump: "major" }],
      summary: "Initial v1.0.0 release.",
    });
  });

  it("parses a multi-package changeset", () => {
    const content = '---\n"@eo/contracts": patch\n"@eo/journal": minor\n---\n\nFix + feature.\n';
    const entry = parseChangesetFile("fixture.md", content);
    expect(entry?.packages).toEqual([
      { packageName: "@eo/contracts", bump: "patch" },
      { packageName: "@eo/journal", bump: "minor" },
    ]);
  });

  it("returns undefined for content with no frontmatter at all (e.g. README.md)", () => {
    expect(parseChangesetFile("README.md", "# Changesets\n\nHello!\n")).toBeUndefined();
  });

  it("skips a blank line inside the frontmatter and ignores a non-bump frontmatter line", () => {
    const content =
      '---\n\n"engineering-orchestrator": patch\nsome-other-key: ignored\n---\n\nBody.\n';
    const entry = parseChangesetFile("fixture.md", content);
    expect(entry?.packages).toEqual([{ packageName: "engineering-orchestrator", bump: "patch" }]);
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
    await writeFile(
      join(dir, "one-fish.md"),
      '---\n"engineering-orchestrator": major\n---\n\nFirst change.\n',
    );
    await writeFile(
      join(dir, "two-fish.md"),
      '---\n"engineering-orchestrator": patch\n---\n\nSecond change.\n',
    );
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
    await writeFile(
      join(dir, "real-one.md"),
      '---\n"engineering-orchestrator": patch\n---\n\nReal change.\n',
    );
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
          packages: [{ packageName: "engineering-orchestrator", bump: "major" }],
          summary: "Initial v1.0.0 release.",
        },
      ],
    });
    expect(draft).toContain("## 1.0.0 (2026-07-24)");
    expect(draft).toContain("Initial v1.0.0 release. (engineering-orchestrator: major)");
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
  it("reflects today's real state: zero real changesets recorded yet, so the draft is an honest header-only placeholder", async () => {
    const repoRoot = (
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname })
    ).stdout.trim();
    const changesetDir = resolve(repoRoot, ".changeset");

    const entries = readChangesetEntries(changesetDir);
    expect(entries).toEqual([]);

    const draft = draftChangelog({ version: "1.0.0", entries });
    expect(draft).toContain("## 1.0.0");
    expect(draft).toContain("No `.changeset/*.md` entries were recorded");
  });
});
