/**
 * THE SQUASH SUBJECT IS NOT ANY COMMIT ON THE BRANCH.
 *
 * `.github/workflows/ci.yml`'s `commitlint` job lints the commits BETWEEN
 * the PR's base and head. On a squash merge GitHub does not keep any of
 * them: it writes ONE new commit whose subject is the PR TITLE with
 * ` (#<number>)` appended, and whose body is the branch's subjects as a
 * bullet list. That subject is linted by nothing before the merge button.
 *
 * MEASURED, not hypothesised. Commit `cf67bd2` ("feat: red-before-green
 * that discriminates, engine re-baseline at 2.1.224, and design-approval
 * minting (#166)") reddened `main`:
 *
 *   ✖ header must not be longer than 100 characters, current length is 108
 *
 * Every commit on that branch passed the PR-side step. The title was 100
 * characters; GitHub's ` (#166)` suffix carried it to 108. `main`'s CI has
 * been red since, and cannot be made green retroactively without rewriting
 * published history — so the only available fix is the one asserted here:
 * lint the subject that WILL BE WRITTEN, while the PR is still open.
 *
 * These assertions read the REAL workflow file rather than a fixture, for
 * the same reason `engine-live-workflow.test.ts` does: a producer and a
 * consumer that drift apart with the suite still green is the failure this
 * repository keeps paying for.
 *
 * WHAT THIS DOES NOT PROVE. It proves the step exists, fires on the right
 * event, reconstructs the suffix, and takes the title through the
 * environment. It does not prove GitHub's squash subject format, which is
 * the platform's behaviour and is evidenced by `cf67bd2` above; nor does it
 * prove the repository merges by squash rather than by merge commit — a
 * repository setting no test here can read.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePluginRoot } from "./plugin-root.js";

const REPO_ROOT = join(resolvePluginRoot(), "..", "..");
const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");

/**
 * The `commitlint` job's text, from its own key to the next job at the same
 * indent. Hand-rolled for the reason `engine-live-workflow.test.ts` gives:
 * this package has no YAML dependency, and adding one to assert a handful
 * of CI lines is not worth the supply-chain surface.
 */
function commitlintJob(): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line === "  commitlint:");
  expect(start, "ci.yml must declare a `commitlint` job at indent 2").toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

describe("the commitlint job lints the subject a squash merge will write", () => {
  const job = commitlintJob();

  it("carries a step that lints the PR title, not only the branch commits", () => {
    // The pre-existing step lints a RANGE (`--from`/`--to`). A range can
    // never contain the squash commit, which does not exist yet.
    expect(job).toMatch(/--from/);
    // The new step must pipe a reconstructed subject into a bare commitlint,
    // which reads one message from stdin.
    expect(job, "no step feeds a single message to commitlint on stdin").toMatch(
      /\|\s*npx commitlint/,
    );
  });

  it("appends the ` (#<number>)` suffix GitHub adds, so the 100-char limit is measured on the real subject", () => {
    expect(job, "the linted subject must reconstruct GitHub's ` (#N)` suffix").toMatch(
      /\(#%s\)|\(#\$\{?PR_NUMBER/,
    );
  });

  it("fires on pull_request, where the title still can be changed", () => {
    const titleStep = job.slice(job.indexOf("PR_TITLE"));
    expect(job).toContain("PR_TITLE");
    expect(
      job.slice(0, job.indexOf("PR_TITLE")),
      "the title-lint step must be guarded by `github.event_name == 'pull_request'`",
    ).toMatch(/if:\s*github\.event_name == 'pull_request'[\s\S]*$/);
    expect(titleStep.length).toBeGreaterThan(0);
  });

  it("passes the title through the environment, never interpolated into the shell", () => {
    // A PR title is attacker-controlled text. `run: ... ${{ ...title }}` is
    // substituted before the shell parses the line, so a title containing
    // `$(...)` or a newline executes on the runner. `env:` is the only safe
    // channel: the value arrives as a variable, already quoted at use.
    expect(job, "the title must reach the step via `env:`").toMatch(
      /env:\s*\n\s+PR_TITLE:\s*\$\{\{\s*github\.event\.pull_request\.title\s*\}\}/,
    );
    const runLines = job.split("\n").filter((line) => /run:/.test(line) || /^\s+\S.*\$\{\{/.test(line));
    for (const line of runLines) {
      expect(line, `a run: line interpolates the PR title directly: ${line.trim()}`).not.toMatch(
        /run:.*\$\{\{[^}]*pull_request\.title/,
      );
    }
  });
});
