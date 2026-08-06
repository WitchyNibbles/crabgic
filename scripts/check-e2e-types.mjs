#!/usr/bin/env node
/**
 * Typechecks every `e2e/` project and reports ALL failures, not just the first.
 *
 * The previous form was eight `tsc -p … --noEmit` invocations `&&`-chained in
 * `package.json`. That hides state: when `e2e/matrix/orchestration` (the
 * fourth link) was red on `main` with 25 errors, the chain short-circuited and
 * the four projects after it were never typechecked at all — so nobody knew
 * whether they were clean. `release-e2e.yml` calls this script, so "the first
 * failure hides the rest" is a property of the release gate too.
 *
 * Each project is now run independently and every failure is reported. Exit
 * status is non-zero if ANY project fails, so the gate is exactly as strict;
 * what changes is that one red project no longer conceals the others.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every `e2e/` project with its own tsconfig, in the order they were chained. */
export const E2E_TYPECHECK_PROJECTS = [
  "e2e/provisioning",
  "e2e/matrix/installation",
  "e2e/matrix/git",
  "e2e/matrix/orchestration",
  "e2e/matrix/connector",
  "e2e/live",
  "e2e/release",
  "e2e/attestation",
];

function typecheckProject(project) {
  const tsconfig = join(REPO_ROOT, project, "tsconfig.json");
  if (!existsSync(tsconfig)) {
    return { project, ok: false, output: `no tsconfig.json at ${project}/tsconfig.json` };
  }
  const result = spawnSync("npx", ["tsc", "-p", tsconfig, "--noEmit"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { project, ok: result.status === 0, output };
}

function main() {
  const results = E2E_TYPECHECK_PROJECTS.map((project) => {
    const result = typecheckProject(project);
    process.stdout.write(`check-e2e-types: ${result.ok ? "PASS" : "FAIL"} — ${project}\n`);
    if (!result.ok && result.output.length > 0) {
      process.stdout.write(`${result.output}\n`);
    }
    return result;
  });

  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    process.stdout.write(
      `check-e2e-types: PASS — ${String(results.length)} project(s) typechecked clean.\n`,
    );
    return 0;
  }
  process.stdout.write(
    `check-e2e-types: FAIL — ${String(failed.length)} of ${String(results.length)} project(s) failed: ${failed
      .map((r) => r.project)
      .join(", ")}\n`,
  );
  return 1;
}

process.exit(main());
