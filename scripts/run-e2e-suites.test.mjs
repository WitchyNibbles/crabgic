import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { E2E_SUITE_PROJECTS, runAllProjects, summarize } from "./run-e2e-suites.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The property the `&&` chain did NOT have, asserted directly.
 *
 * `npm run test:e2e:release-evidence` was eight `vitest run` invocations joined
 * by `&&`. `e2e/release` is the seventh and fails by construction before a
 * release tag exists, so `e2e/attestation` — the eighth — could not run on CI
 * at all before a tag. These cases pin the replacement, and each one fails
 * against a chained implementation.
 */
describe("run-e2e-suites runs every project, and a failure in the middle stops nothing", () => {
  it("runs ALL eight projects when the seventh fails — the exact pre-tag shape", () => {
    const attempted = [];
    const results = runAllProjects((project) => {
      attempted.push(project);
      return { project, ok: project !== "e2e/release" };
    });

    // A chained implementation attempts seven and stops. This is the assertion
    // that separates the two, and it is about the ATTEMPTS, not the verdicts.
    expect(attempted).toEqual([...E2E_SUITE_PROJECTS]);
    expect(attempted).toContain("e2e/attestation");
    expect(attempted.indexOf("e2e/attestation")).toBeGreaterThan(attempted.indexOf("e2e/release"));
    expect(results).toHaveLength(8);
    expect(results.filter((r) => !r.ok).map((r) => r.project)).toEqual(["e2e/release"]);
  });

  it("attempts every project even when the FIRST one fails", () => {
    const attempted = [];
    runAllProjects((project) => {
      attempted.push(project);
      return { project, ok: project !== "e2e/provisioning" };
    });
    expect(attempted).toEqual([...E2E_SUITE_PROJECTS]);
  });

  it("reports every failure, not only the first", () => {
    const results = runAllProjects((project) => ({
      project,
      ok: project !== "e2e/matrix/git" && project !== "e2e/attestation",
    }));
    const { code, line } = summarize(results, "run-e2e-suites");
    expect(code).toBe(1);
    expect(line).toContain("2 of 8");
    expect(line).toContain("e2e/matrix/git");
    expect(line).toContain("e2e/attestation");
  });

  it("CONTROL — an all-green run exits 0 and says so", () => {
    const results = runAllProjects((project) => ({ project, ok: true }));
    expect(summarize(results, "run-e2e-suites")).toEqual({
      code: 0,
      line: "run-e2e-suites: PASS — 8 e2e project(s) green.",
    });
  });

  it("keeps the chain's original project order, so job logs stay comparable", () => {
    expect(E2E_SUITE_PROJECTS).toEqual([
      "e2e/provisioning",
      "e2e/matrix/installation",
      "e2e/matrix/git",
      "e2e/matrix/orchestration",
      "e2e/matrix/connector",
      "e2e/live",
      "e2e/release",
      "e2e/attestation",
    ]);
  });
});

describe("the npm scripts are wired to the runner rather than to an && chain", () => {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

  /**
   * A string check on the manifest, because that is where the defect lived: the
   * runner can be perfect and the release gate still chained. `release-e2e.yml`
   * invokes `npm run test:e2e:release-evidence` by name, and
   * `e2e/attestation/src/arm64Verification.test.ts` pins that step's `run:`
   * line, so the SCRIPT is the only place this can be fixed.
   */
  it("test:e2e:release-evidence calls the runner and contains no && chain", () => {
    const script = manifest.scripts["test:e2e:release-evidence"];
    expect(script).toContain("scripts/run-e2e-suites.mjs");
    expect(script).not.toContain("&&");
  });

  it("test:e2e calls the runner and contains no && chain", () => {
    const script = manifest.scripts["test:e2e"];
    expect(script).toContain("scripts/run-e2e-suites.mjs");
    expect(script).not.toContain("&&");
  });

  it("every project the runner knows about has a vitest config on disk", () => {
    for (const project of E2E_SUITE_PROJECTS) {
      expect(
        readFileSync(join(REPO_ROOT, project, "vitest.config.ts"), "utf8").length,
      ).toBeGreaterThan(0);
    }
  });
});
