#!/usr/bin/env node
/**
 * Runs every `e2e/` harness's offline suite and reports ALL failures, not just
 * the first.
 *
 * WHY THIS EXISTS — the same finding, in the same shape, one seam over.
 * `scripts/check-e2e-types.mjs` replaced eight `&&`-chained `tsc` invocations
 * for exactly this reason, and `docs/verification-playbook.md` records the
 * result as "the bigger of the two findings and the part that cannot recur
 * silently": with the chain, one red project conceals every project after it,
 * **including in `release-e2e.yml`**. `test:e2e:release-evidence` was still the
 * chained form, and it is the release gate's own harness step.
 *
 * The consequence was not hypothetical and was not symmetric. `e2e/release` is
 * the SEVENTH of eight, and before a release tag exists it fails by
 * construction (`releaseTag.exists === false` — the tag is the last thing an
 * owner does). So the eighth project, `e2e/attestation`, could never run on CI
 * before a tag: the chain always died one link short of it. `e2e/attestation`
 * is the project that binds the six harnesses' frozen `requirementId` literals
 * to the roadmap corpus they are derived from — the check whose desync this
 * script's own release cut had to fix by hand, having been invisible to every
 * push and every pre-tag dispatch. Its first CI execution would otherwise have
 * been AT the tag, which is the most expensive moment to learn anything.
 *
 * Exit status is unchanged in strength: non-zero if ANY project fails. What
 * changes is that all eight report.
 *
 * NOT fixed here, and stated so it is not mistaken for fixed: the
 * `Run the ReleaseGateReport generator` step in `.github/workflows/
 * release-e2e.yml` carries no `if:`, so a non-zero exit from the harness step
 * still skips it and still produces no `release-gate-report` artifact. Before a
 * tag exists that is guaranteed. Read the pre-tag go/no-go out of THIS script's
 * per-project summary in the job log; the artifact is a post-tag signal.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every self-contained `e2e/` harness, in the order the `&&` chain ran them.
 *
 * Order is preserved deliberately rather than sorted: the release-evidence run
 * journals `EvidenceRecord`s as it goes, and a reader comparing a new job log
 * against an archived one should not have to reconcile a reordering on top of
 * whatever actually changed.
 */
export const E2E_SUITE_PROJECTS = [
  "e2e/provisioning",
  "e2e/matrix/installation",
  "e2e/matrix/git",
  "e2e/matrix/orchestration",
  "e2e/matrix/connector",
  "e2e/live",
  "e2e/release",
  "e2e/attestation",
];

/**
 * Runs every project and returns one result per project — ALWAYS one per
 * project, however many failed.
 *
 * `runProject` is injectable so the suite can assert the property that matters
 * and that the `&&` form did not have: a failure in the middle does not stop
 * the projects after it. Asserting that against real vitest runs would take
 * minutes and would measure vitest rather than this loop.
 */
export function runAllProjects(runProject, projects = E2E_SUITE_PROJECTS) {
  return projects.map((project) => runProject(project));
}

export function summarize(results, label) {
  const failed = results.filter((result) => !result.ok);
  if (failed.length === 0) {
    return {
      code: 0,
      line: `${label}: PASS — ${String(results.length)} e2e project(s) green.`,
    };
  }
  return {
    code: 1,
    line:
      `${label}: FAIL — ${String(failed.length)} of ${String(results.length)} e2e project(s) ` +
      `failed: ${failed.map((result) => result.project).join(", ")}`,
  };
}

function vitestProject(project, fileParallelism) {
  const config = join(REPO_ROOT, project, "vitest.config.ts");
  if (!existsSync(config)) {
    process.stdout.write(`no vitest.config.ts at ${project}/vitest.config.ts\n`);
    return { project, ok: false };
  }
  const args = ["vitest", "run"];
  if (!fileParallelism) args.push("--no-file-parallelism");
  args.push("--config", config);
  // `stdio: "inherit"` on purpose: this is a CI harness step and the per-file
  // vitest output IS the evidence a reader byte-compares. Capturing it would
  // buffer eight suites' worth of output and print it only at the end, which
  // is worse for a long job and worse for anyone watching one.
  const result = spawnSync("npx", args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return { project, ok: result.status === 0 };
}

function main(argv) {
  const fileParallelism = argv.includes("--file-parallelism");
  const label = fileParallelism ? "run-e2e-suites" : "run-e2e-suites (release-evidence)";
  const results = runAllProjects((project) => {
    process.stdout.write(`\n${label}: running ${project}\n`);
    const result = vitestProject(project, fileParallelism);
    process.stdout.write(`${label}: ${result.ok ? "PASS" : "FAIL"} — ${project}\n`);
    return result;
  });
  const { code, line } = summarize(results, label);
  process.stdout.write(
    `\n${results.map((r) => `  ${r.ok ? "PASS" : "FAIL"} ${r.project}`).join("\n")}\n`,
  );
  process.stdout.write(`${line}\n`);
  return code;
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
