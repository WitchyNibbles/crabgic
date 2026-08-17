import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GIT_FIXTURE_IDENTITY_ENV } from "@crabgic/testkit";
import { parseChangedLines } from "./changed-lines.js";

/**
 * The parser against REAL `git diff` output, cross-checked against git's OWN
 * added-line counts (`--numstat`) — not against a fixture this file wrote.
 *
 * WHY THIS EXISTS BESIDE `./changed-lines.test.ts`. Every case in that file is a
 * diff I hand-wrote, so every case can share one misunderstanding of the format
 * and all of them still pass. That is the vacuity shape
 * `docs/verification-playbook.md` names: a suite that agrees with its author.
 * Here git produces the input and git produces the expected answer; this file
 * supplies only the source content and the comparison.
 *
 * WHAT THE COMPARISON IS. `git diff --numstat` reports added lines per file,
 * computed by git's own diff engine rather than by reading git's own text
 * output. So a parser that misreads hunk headers, mishandles a removed line, or
 * desynchronizes on a blank context line disagrees here — which is exactly what
 * the hand-written suite cannot catch.
 *
 * HERMETIC, deliberately: a repository built in a temp dir per test. An earlier
 * draft ran this over crabgic's own history (4177 file-diffs across 374
 * non-merge commits, exact agreement) and that was a good probe, but a committed
 * test must not depend on the checkout's depth — CI clones most jobs shallow, and
 * a test that quietly measures two commits instead of four hundred still passes.
 *
 * MERGE COMMITS ARE NOT EXERCISED, and the reason is recorded rather than left
 * as a silent gap: `git show` prints no diff for a merge without `--cc`/`-m`,
 * while `--numstat` still reports one, so comparing the two measures the probe
 * and not the parser. `./changed-lines.test.ts` covers the combined-diff (`@@@`)
 * shape directly instead, where the expected answer is "attribute nothing".
 */

let repo: string;

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...GIT_FIXTURE_IDENTITY_ENV },
    maxBuffer: 32 * 1024 * 1024,
  });
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "eo-gates-changed-lines-"));
  git(["init", "-q", "-b", "main"]);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

/**
 * Makes untracked files visible to `git diff` without committing them
 * (`--intent-to-add`). Without it a newly created file appears in NEITHER
 * `--numstat` nor the diff text, and the comparison below would agree
 * vacuously — which is what `expectAgreement`'s own non-emptiness guard caught
 * the first time this file was written.
 */
function stageIntentToAdd(): void {
  git(["add", "-A", "-N"]);
}

/**
 * git's own answer: path → added-line count, straight from `--numstat`.
 *
 * Zero-count rows are DROPPED. A pure deletion is reported by `--numstat` as
 * `0 <removed> path`, while the parser records no entry at all; both mean "this
 * change set added no lines here", and keeping the row would compare two
 * spellings of the same answer.
 */
function numstatAdded(): ReadonlyMap<string, number> {
  const added = new Map<string, number>();
  for (const row of git(["diff", "--numstat", "HEAD"]).trim().split("\n")) {
    if (row.length === 0) continue;
    const [count, , path] = row.split("\t");
    if (count === "-" || path === undefined) continue; // binary
    const parsed = Number.parseInt(count ?? "0", 10);
    if (parsed > 0) added.set(path, parsed);
  }
  return added;
}

/** The parser's answer over the same working-tree change. */
function parsedAdded(): ReadonlyMap<string, number> {
  const parsed = parseChangedLines(git(["diff", "--no-color", "-U3", "HEAD"]));
  return new Map([...parsed].map(([path, lines]) => [path, lines.size]));
}

function commitAll(message: string): void {
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message, "--no-verify"]);
}

async function write(path: string, content: string): Promise<void> {
  await writeFile(join(repo, path), content, "utf8");
}

/** Asserts the parser and git agree, and that the comparison was not vacuous. */
function expectAgreement(): void {
  stageIntentToAdd();
  const expected = numstatAdded();
  expect(expected.size).toBeGreaterThan(0);
  expect(Object.fromEntries(parsedAdded())).toStrictEqual(Object.fromEntries(expected));
}

describe("parseChangedLines against real git output", () => {
  it("agrees with git on a mixed edit — additions, removals, and untouched context", async () => {
    await write("a.ts", ["one", "two", "three", "four", "five", "six"].join("\n") + "\n");
    commitAll("base");
    await write("a.ts", ["one", "INSERTED", "three", "REPLACED", "six", "APPENDED"].join("\n") + "\n");
    expectAgreement();
  });

  /**
   * The blank-line case, which is where a hand-written fixture is least likely to
   * be right: git writes a blank context line with no leading space, and a parser
   * that reads that as a section break silently drops every added line after the
   * first blank line in a hunk.
   */
  it("agrees on a file whose hunks contain blank context lines", async () => {
    await write("b.ts", "const a = 1;\n\nconst b = 2;\n\nconst c = 3;\n\nconst d = 4;\n");
    commitAll("base");
    await write(
      "b.ts",
      "const a = 1;\n\nconst b = 2;\nconst added1 = 0;\n\nconst c = 3;\n\nconst d = 4;\nconst added2 = 0;\n",
    );
    expectAgreement();
  });

  it("agrees on a newly created file", async () => {
    await write("keep.ts", "x\n");
    commitAll("base");
    await write("fresh.ts", ["a", "b", "c", "d"].join("\n") + "\n");
    expectAgreement();
  });

  it("agrees on a file with no trailing newline", async () => {
    await write("c.ts", "first\nsecond");
    commitAll("base");
    await write("c.ts", "first\nsecond\nthird");
    expectAgreement();
  });

  it("agrees across several files changed at once", async () => {
    await write("one.ts", "a\nb\nc\n");
    await write("two.ts", "a\nb\nc\n");
    await write("three.ts", "a\nb\nc\n");
    commitAll("base");
    await write("one.ts", "a\nADDED\nb\nc\n");
    await write("two.ts", "a\nb\nc\nADDED1\nADDED2\n");
    await write("three.ts", "REPLACED\nb\nc\n");
    expectAgreement();
  });

  /** A deleted file contributes no added lines, and must not attribute its removals to the next file. */
  it("agrees when a file is deleted alongside another being extended", async () => {
    await write("gone.ts", "a\nb\nc\n");
    await write("stays.ts", "a\nb\nc\n");
    commitAll("base");
    await rm(join(repo, "gone.ts"));
    await write("stays.ts", "a\nb\nc\nADDED\n");
    expectAgreement();
  });

  /**
   * Many small hunks in one file, which is where a cursor that drifts by one
   * shows up: a single mis-advanced context line shifts every hunk after it, and
   * the totals still look plausible.
   */
  it("agrees on a large file edited in many separate places", async () => {
    const base = Array.from({ length: 200 }, (_, i) => `line ${String(i)}`);
    await write("big.ts", base.join("\n") + "\n");
    commitAll("base");
    const edited = [...base];
    for (let i = 190; i >= 10; i -= 20) edited.splice(i, 0, `inserted at ${String(i)}`);
    await write("big.ts", edited.join("\n") + "\n");
    expectAgreement();
  });

  /**
   * ⚠️ The strongest case here: the parser must report the exact LINE NUMBERS,
   * not merely the right count. `--numstat` only checks the count, so this reads
   * the new file back and asserts every reported line is one of the inserted
   * ones — a parser off by a constant would satisfy every count check above.
   */
  it("reports line numbers that really hold the inserted text", async () => {
    const base = Array.from({ length: 40 }, (_, i) => `original ${String(i)}`);
    await write("exact.ts", base.join("\n") + "\n");
    commitAll("base");
    const edited = [...base];
    edited.splice(30, 0, "INSERTED-C");
    edited.splice(15, 0, "INSERTED-B");
    edited.splice(3, 0, "INSERTED-A");
    await write("exact.ts", edited.join("\n") + "\n");

    stageIntentToAdd();
    const reported = parseChangedLines(git(["diff", "--no-color", "-U3", "HEAD"])).get("exact.ts");
    expect(reported).toBeDefined();
    const fileLines = edited;
    for (const lineNumber of reported!) {
      expect(fileLines[lineNumber - 1]).toMatch(/^INSERTED-/);
    }
    expect([...reported!].sort((a, b) => a - b)).toStrictEqual([4, 17, 33]);
  });
});
