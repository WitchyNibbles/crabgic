import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * `CHANGELOG.md` v1.0.0 draft PREPARER — roadmap/23-release-hardening.md
 * work item 10: "a `CHANGELOG.md` v1.0.0 draft via changesets if present."
 *
 * PREPARE-DON'T-PUBLISH (owner decision): this module never shells out to
 * the real, MUTATING `changeset version` command (which rewrites every
 * workspace package's own `package.json` version, deletes the consumed
 * `.changeset/*.md` files, and writes `CHANGELOG.md` — a real, committed
 * side effect this task's own constraints forbid: "Do NOT commit", "no
 * packages/* source edits"). Instead it reads `.changeset/*.md`'s OWN
 * committed data format/convention directly (frontmatter package/bump
 * lines + a markdown body) — "via changesets" in the sense of using that
 * tool's own established file convention, never in the sense of invoking
 * its mutating CLI command — and synthesizes a draft string in memory.
 * Nothing this module does ever writes to the real, root `CHANGELOG.md`.
 */

export type ChangesetBump = "major" | "minor" | "patch";

export interface ChangesetPackageBump {
  readonly packageName: string;
  readonly bump: ChangesetBump;
}

export interface ChangesetEntry {
  readonly filename: string;
  readonly packages: readonly ChangesetPackageBump[];
  readonly summary: string;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
const BUMP_LINE_PATTERN = /^"([^"]+)":\s*(major|minor|patch)\s*$/;

/** Parses one changeset `.md` file's content into a `ChangesetEntry` — `undefined` if it doesn't match the changesets frontmatter convention at all (a non-changeset stray file, e.g. `README.md`). */
export function parseChangesetFile(filename: string, content: string): ChangesetEntry | undefined {
  const match = FRONTMATTER_PATTERN.exec(content);
  if (match === null) {
    return undefined;
  }
  const [, frontmatter, body] = match;
  const packages: ChangesetPackageBump[] = [];
  for (const line of (frontmatter ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const bumpMatch = BUMP_LINE_PATTERN.exec(trimmed);
    if (bumpMatch !== null) {
      const [, packageName, bump] = bumpMatch;
      packages.push({ packageName: packageName ?? "", bump: bump as ChangesetBump });
    }
  }
  return { filename, packages, summary: (body ?? "").trim() };
}

/** Reads every real `.changeset/*.md` file (skipping `README.md`, which is `@changesets/cli`'s own scaffolded doc, never a real changeset) and parses each one. Tolerates a `.changeset` directory that doesn't exist yet or contains zero real changesets — returns `[]`, never throws. */
export function readChangesetEntries(changesetDir: string): readonly ChangesetEntry[] {
  let filenames: readonly string[];
  try {
    filenames = readdirSync(changesetDir).filter(
      (name) => name.endsWith(".md") && name.toLowerCase() !== "readme.md",
    );
  } catch {
    return [];
  }
  const entries: ChangesetEntry[] = [];
  for (const filename of filenames) {
    const content = readFileSync(join(changesetDir, filename), "utf8");
    const parsed = parseChangesetFile(filename, content);
    if (parsed !== undefined) {
      entries.push(parsed);
    }
  }
  return entries;
}

export interface DraftChangelogOptions {
  readonly version: string;
  readonly entries: readonly ChangesetEntry[];
  /** Injectable for deterministic tests; defaults to today's real UTC date. */
  readonly releaseDate?: () => string;
}

function defaultReleaseDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The exact sentence `draftChangelog` emits when there was nothing to
 * draft FROM. Exported (rather than hand-retyped at the call site) so
 * `releaseGateSummary`'s scoring of the prepared draft cannot silently
 * drift from the text this module actually produces.
 */
export const CHANGELOG_PLACEHOLDER_MARKER =
  "_No `.changeset/*.md` entries were recorded at draft time";

/** `true` iff `draft` is the header-only placeholder — i.e. no reviewed change notes back this release. */
export function isPlaceholderChangelogDraft(draft: string): boolean {
  return draft.includes(CHANGELOG_PLACEHOLDER_MARKER);
}

/**
 * Synthesizes a `CHANGELOG.md`-style v1.0.0 draft as a plain string —
 * never written to any file by this function. When `entries` is empty
 * (this repo's own current, real state — zero `.changeset/*.md` files
 * exist yet), the draft is header-only and says so explicitly, rather
 * than fabricating change notes that were never actually recorded.
 */
export function draftChangelog(options: DraftChangelogOptions): string {
  const date = (options.releaseDate ?? defaultReleaseDate)();
  const header = `## ${options.version} (${date})`;
  if (options.entries.length === 0) {
    return (
      `${header}\n\n` +
      `${CHANGELOG_PLACEHOLDER_MARKER} — this is a header-only ` +
      "placeholder. Author real changesets (`npx changeset add`) before the actual v1.0.0 cut so " +
      "this section reflects real, reviewed change notes._\n"
    );
  }
  const bullets = options.entries
    .flatMap((entry) =>
      entry.summary.length > 0
        ? [
            `- ${entry.summary.replace(/\n+/g, " ").trim()} (${entry.packages.map((p) => `${p.packageName}: ${p.bump}`).join(", ")})`,
          ]
        : [],
    )
    .join("\n");
  return `${header}\n\n${bullets}\n`;
}
