import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkNpmNameRecheck,
  NPM_NAME_RECHECK_MAX_AGE_DAYS,
  RELEASE_NOTES_PREP_REL_PATH,
} from "./npmNameRecheck.js";

const execFileAsync = promisify(execFile);

const dirs: string[] = [];
async function makeRepoRoot(contents: string | undefined): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-npm-name-recheck-"));
  dirs.push(dir);
  if (contents !== undefined) {
    await mkdir(join(dir, "docs"), { recursive: true });
    await writeFile(join(dir, RELEASE_NOTES_PREP_REL_PATH), contents, "utf8");
  }
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const NOW = new Date("2026-07-25T00:00:00Z");
const now = (): Date => NOW;

function record(verdict: string, timestamp: string): string {
  return `# Release notes prep\n\n## npm package name availability — \`crabgic\`\n\n**Verdict: ${verdict} as of ${timestamp}.**\n`;
}

describe("checkNpmNameRecheck — unit", () => {
  it("reports a missing docs/release-notes-prep.md with a quotable reason", async () => {
    const repoRoot = await makeRepoRoot(undefined);
    const result = checkNpmNameRecheck({ repoRoot, packageName: "crabgic", now });
    expect(result.recordExists).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain(RELEASE_NOTES_PREP_REL_PATH);
  });

  it("reports a record that never names the package being published", async () => {
    const repoRoot = await makeRepoRoot(record("available (unclaimed)", "2026-07-24T00:00:00Z"));
    const result = checkNpmNameRecheck({ repoRoot, packageName: "some-other-name", now });
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("some-other-name");
  });

  it("reports a record with no parseable verdict/timestamp", async () => {
    const repoRoot = await makeRepoRoot("# Release notes prep\n\ncrabgic\n");
    const result = checkNpmNameRecheck({ repoRoot, packageName: "crabgic", now });
    expect(result.recordedAt).toBeUndefined();
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("timestamped");
  });

  it("reports a verdict of TAKEN as a release blocker", async () => {
    const repoRoot = await makeRepoRoot(record("taken", "2026-07-24T00:00:00Z"));
    const result = checkNpmNameRecheck({ repoRoot, packageName: "crabgic", now });
    expect(result.verdictAvailable).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("taken");
  });

  it("reports a STALE record — the re-check has not been run for this release", async () => {
    const repoRoot = await makeRepoRoot(record("available (unclaimed)", "2026-07-01T00:00:00Z"));
    const result = checkNpmNameRecheck({ repoRoot, packageName: "crabgic", now });
    expect(result.verdictAvailable).toBe(true);
    expect(result.fresh).toBe(false);
    expect(result.ageDays).toBe(24);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain(String(NPM_NAME_RECHECK_MAX_AGE_DAYS));
  });

  it("passes with zero reasons for the NEWEST timestamped verdict when it is fresh and `available`", async () => {
    const repoRoot = await makeRepoRoot(
      `${record("taken", "2026-01-01T00:00:00Z")}\n${record("available (unclaimed)", "2026-07-24T00:00:00Z")}`,
    );
    const result = checkNpmNameRecheck({ repoRoot, packageName: "crabgic", now });
    expect(result.recordedAt).toBe("2026-07-24T00:00:00Z");
    expect(result.verdictAvailable).toBe(true);
    expect(result.fresh).toBe(true);
    expect(result.reasons).toEqual([]);
  });
});

/**
 * The precise false-green this module exists to eliminate, re-found INSIDE
 * it by the adversarial review: scanning for the first `Verdict:` and,
 * separately, for the newest timestamp anywhere in the file pairs an OLD
 * verdict with a NEW date. The doc convention is to APPEND each re-check,
 * so the first verdict is the OLDEST one. Verdict and timestamp must be
 * read as ONE unit.
 */
describe("checkNpmNameRecheck — a verdict is bound to ITS OWN timestamp, never to another line's", () => {
  it("FAIL-FIRST: a newer `taken` verdict below an older `available` one blocks the release", async () => {
    const repoRoot = await makeRepoRoot(
      `${record("available (unclaimed)", "2026-01-01T00:00:00Z")}\n${record("taken", "2026-07-24T00:00:00Z")}`,
    );
    const result = checkNpmNameRecheck({ repoRoot, packageName: "crabgic", now });
    expect(result.recordedAt).toBe("2026-07-24T00:00:00Z");
    expect(result.verdictAvailable).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("taken");
  });

  it("FAIL-FIRST: an unrelated fresh timestamp (a typo-fix edit) does NOT stand in for a re-check", async () => {
    const repoRoot = await makeRepoRoot(
      `${record("available (unclaimed)", "2026-01-01T00:00:00Z")}\n` +
        "_Doc last reviewed 2026-07-24T09:00:00Z (typo fix only; no `npm view` was run)._\n",
    );
    const result = checkNpmNameRecheck({ repoRoot, packageName: "crabgic", now });
    expect(result.recordedAt).toBe("2026-01-01T00:00:00Z");
    expect(result.fresh).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain(String(NPM_NAME_RECHECK_MAX_AGE_DAYS));
  });

  it("FAIL-FIRST: a bare timestamp with no verdict attached is not a re-check at all", async () => {
    const repoRoot = await makeRepoRoot(
      "# Release notes prep\n\ncrabgic was mentioned at 2026-07-24T00:00:00Z.\n",
    );
    const result = checkNpmNameRecheck({ repoRoot, packageName: "crabgic", now });
    expect(result.recordedAt).toBeUndefined();
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("timestamped");
  });

  it("FAIL-FIRST: a verdict word with no timestamp attached is not a re-check either", async () => {
    const repoRoot = await makeRepoRoot(
      "# Release notes prep\n\n**Verdict: available** for crabgic.\n",
    );
    const result = checkNpmNameRecheck({ repoRoot, packageName: "crabgic", now });
    expect(result.recordedAt).toBeUndefined();
    expect(result.verdictAvailable).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("timestamped");
  });
});

describe("checkNpmNameRecheck — this repo's own real docs/release-notes-prep.md", () => {
  /**
   * REWRITTEN 2026-07-26. This used to assert `fresh === false` — "today the
   * recorded verdict is phase 01's, not a release-time re-check" — which was
   * true when written and stopped being true the moment the verdict was
   * re-recorded for the renamed package. Pinning a transient repository state
   * makes a test that fails on being FIXED, so it now asserts the behaviour
   * instead, evaluated relative to whatever the record itself says. It cannot
   * rot as the record is refreshed, and it still fails if the record is
   * missing, malformed, unavailable, or read against a clock outside the
   * freshness window.
   */
  it("reads this repo's real record and decides freshness against its own timestamp", async () => {
    const repoRoot = (
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname })
    ).stdout.trim();

    const asOfRecord = checkNpmNameRecheck({
      repoRoot,
      packageName: "crabgic",
      now: () => new Date(),
    });
    expect(asOfRecord.recordExists).toBe(true);
    expect(asOfRecord.verdictAvailable).toBe(true);
    expect(asOfRecord.recordedAt).toBeDefined();

    const recordedAt = new Date(asOfRecord.recordedAt ?? 0).getTime();
    const days = (n: number) => (): Date => new Date(recordedAt + n * 86_400_000);

    // Inside the window it stands for the release...
    const fresh = checkNpmNameRecheck({ repoRoot, packageName: "crabgic", now: days(1) });
    expect(fresh.fresh).toBe(true);
    expect(fresh.reasons).toEqual([]);

    // ...and beyond it, it is a stated blocking reason, not a silent pass.
    const stale = checkNpmNameRecheck({ repoRoot, packageName: "crabgic", now: days(30) });
    expect(stale.fresh).toBe(false);
    expect(stale.reasons).toHaveLength(1);
  });
});
