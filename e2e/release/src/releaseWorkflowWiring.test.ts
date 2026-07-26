import { execFile } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { ACCEPTED_ENGINE_VERSION_RANGE, TESTED_ENGINE_VERSION } from "@eo/engine-claude";
import { REBUILD_CHECKOUTS_ENV_VAR } from "./rebuildPopulator.js";

const execFileAsync = promisify(execFile);

/**
 * Producer/consumer binding for the rebuild flag.
 *
 * `resolveBuildOutputPopulator` only ever selects the REBUILDING populator
 * when `EO_RELEASE_REBUILD_CHECKOUTS=1` is present in the environment. A
 * flag no workflow sets is unreachable code, and the reproducible-build
 * exit criterion's first clause ("two independent from-clean-checkout
 * BUILDS") could then never be satisfied in ANY CI configuration — the
 * gate would emit its "rebuild leg did not run" reason forever, which is
 * honest but permanently unclearable.
 *
 * `.github/workflows/release-e2e.yml` is the single leg with network (it
 * runs `npm ci` itself), so it is the one place the flag belongs. This
 * test reads the REAL workflow file — not a fixture — so the flag's
 * producer (the workflow) and its consumer (`rebuildPopulator.ts`) cannot
 * drift apart with every test still green. It also asserts the env-var
 * NAME against the exported constant rather than a second copy of the
 * string literal.
 */

let repoRoot: string;
let workflow: string;

beforeAll(async () => {
  repoRoot = (
    await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname })
  ).stdout.trim();
  workflow = readFileSync(join(repoRoot, ".github", "workflows", "release-e2e.yml"), "utf8");
});

/**
 * Splits the `steps:` sequence into one text block per step. Steps in this
 * workflow are list items at indent 6 (`      - `); everything indented
 * further, plus blank lines, belongs to the step that opened the block.
 * Deliberately hand-rolled: this repo has no YAML dependency, and adding
 * one to assert two lines of CI wiring is not worth the supply-chain
 * surface.
 */
function stepBlocks(yaml: string): readonly string[] {
  const blocks: string[][] = [];
  let current: string[] | undefined;
  for (const line of yaml.split("\n")) {
    if (/^ {6}- /.test(line)) {
      current = [line];
      blocks.push(current);
      continue;
    }
    if (current === undefined) continue;
    if (line.trim() === "" || /^ {8}/.test(line)) current.push(line);
    else current = undefined;
  }
  return blocks.map((lines) => lines.join("\n"));
}

describe("release-e2e.yml wires the rebuild flag it is the only consumer of", () => {
  it("has exactly one step that runs the e2e harnesses", () => {
    const running = stepBlocks(workflow).filter((block) => block.includes("npm run test:e2e"));
    expect(running).toHaveLength(1);
  });

  it(`sets ${REBUILD_CHECKOUTS_ENV_VAR}="1" on that step, so the rebuilding populator is reachable`, () => {
    const [step] = stepBlocks(workflow).filter((block) => block.includes("npm run test:e2e"));
    expect(step).toBeDefined();
    expect(step).toMatch(/^ {8}env:$/m);
    expect(step).toMatch(new RegExp(`^ {10}${REBUILD_CHECKOUTS_ENV_VAR}: "1"$`, "m"));
  });

  it("does not set the flag anywhere else — no other leg has network for `npm ci`", () => {
    // Counts real YAML ASSIGNMENTS (`NAME: …` at some indent), not prose
    // mentions: a `#` comment line can never match, because `#` is the
    // first non-space character on it.
    const assignments = workflow
      .split("\n")
      .filter((line) => new RegExp(`^\\s*${REBUILD_CHECKOUTS_ENV_VAR}:`).test(line));
    expect(assignments).toHaveLength(1);
  });

  it("budgets enough job time for two real `npm ci` + `tsc -b` rebuilds", () => {
    const match = /^ {4}timeout-minutes: (\d+)$/m.exec(workflow);
    expect(match).not.toBeNull();
    // Measured on a WARM local npm cache: ~7.5s `npm ci` + ~14.0s `tsc -b`
    // per checkout, two checkouts populated SEQUENTIALLY, i.e. ~46s for the
    // rebuild leg alone. A cold CI cache is far slower, and this budget
    // also has to cover `npm ci` + `npm run build` + every other harness in
    // `npm run test:e2e`. 30 minutes was set before the rebuild leg existed.
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(60);
  });
});

/**
 * THE RELEASE CANDIDATE MUST BE RESOLVED ONCE, IN A STEP — NOT READ RAW
 * FROM THE WORKFLOW INPUT.
 *
 * `release_candidate_object_id` is an OPTIONAL `workflow_dispatch` input,
 * and a GitHub Actions `${{ inputs.<omitted-optional> }}` expression
 * renders as the EMPTY STRING rather than as an absent variable. Wiring it
 * straight into `EO_RELEASE_CANDIDATE_OBJECT_ID` therefore hands every
 * consumer a present-but-empty variable: `e2e/report/src/cli.ts`'s fallback
 * chain sees `""`, the generator scores all 15 checklist items against
 * object ID `""` and links zero evidence, and `ReleaseGateReportSchema`'s
 * `min(1)` then aborts the generator step outright.
 *
 * These assertions are structural on purpose. A whole-file `toContain`
 * cannot distinguish the wiring from the workflow's own prose about the
 * wiring, and a guard that a revert leaves green is not a guard.
 */
describe("release-e2e.yml resolves the release candidate once, in a step", () => {
  it("never wires the raw workflow input into the object-ID env var", () => {
    expect(workflow).not.toMatch(/EO_RELEASE_CANDIDATE_OBJECT_ID: \$\{\{ inputs\./);
  });

  it("has a `release-candidate` step that writes `object_id` to $GITHUB_OUTPUT", () => {
    const [resolver] = stepBlocks(workflow).filter((block) =>
      /^ {8}id: release-candidate$/m.test(block),
    );
    expect(resolver).toBeDefined();
    expect(resolver).toMatch(/echo "object_id=\$OBJECT_ID" >> "\$GITHUB_OUTPUT"/);
    // Both halves of the fallback live in that step: an explicitly supplied
    // ref is verified as a real commit, an omitted one becomes HEAD.
    expect(resolver).toContain("git rev-parse --verify");
    expect(resolver).toContain("git rev-parse HEAD");
  });

  it("feeds BOTH consumers from that step's output, and from nothing else", () => {
    // Counts real YAML ASSIGNMENTS (`NAME: …` at some indent), never prose:
    // a `#` comment line cannot match, because `#` is its first non-space
    // character. The two consumers are the harness step and the generator.
    const assignments = workflow
      .split("\n")
      .filter((line) => /^\s*EO_RELEASE_CANDIDATE_OBJECT_ID: \S/.test(line));
    expect(assignments).toHaveLength(2);
    for (const line of assignments) {
      expect(line).toContain("steps.release-candidate.outputs.object_id");
    }
  });
});

/**
 * Context availability, which YAML validity does not cover.
 *
 * `${{ runner.temp }}` in a JOB-level `env:` block parses as perfectly valid
 * YAML and is still an INVALID workflow: the `runner` context is only
 * available to `jobs.<id>.steps.*`, never to `jobs.<id>.env`, whose allowed
 * contexts are `github`, `needs`, `strategy`, `matrix`, `vars`, `inputs` and
 * `secrets`. GitHub does not fail the step — it refuses the whole file,
 * creating a run named after the raw workflow path with ZERO jobs and a
 * `failure` conclusion.
 *
 * This is not hypothetical: it is exactly what the first push of the
 * shared-journal wiring produced, and nothing in this repository caught it.
 * `js-yaml` would not have either, because the document is well-formed. The
 * fix is to export the value through `$GITHUB_ENV` from a step, which reaches
 * every later step in the job — the behaviour the job-level block wanted.
 *
 * Scanned across ALL workflows rather than just this one, because the trap is
 * a property of GitHub's context model and not of any single file.
 */
describe("no workflow references a step-only context from a job-level `env:`", () => {
  /** Job-level `env:` is indented 4 (under `  <job-id>:`); step-level is 8. */
  function jobLevelEnvBodies(yaml: string): readonly string[] {
    const bodies: string[][] = [];
    let current: string[] | undefined;
    for (const line of yaml.split("\n")) {
      if (/^ {4}env:\s*$/.test(line)) {
        current = [];
        bodies.push(current);
        continue;
      }
      if (current === undefined) continue;
      if (line.trim() === "" || /^ {6}/.test(line)) current.push(line);
      else current = undefined;
    }
    return bodies.map((lines) => lines.join("\n"));
  }

  it("never uses `runner.*` in a job-level env block, in any workflow", () => {
    const dir = join(repoRoot, ".github", "workflows");
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))) {
      const body = readFileSync(join(dir, file), "utf8");
      for (const env of jobLevelEnvBodies(body)) {
        // Only the `${{ }}` expression form matters. `$RUNNER_TEMP` as a shell
        // variable inside a `run:` script is a different thing and is fine.
        if (/\$\{\{\s*runner\./.test(env)) offenders.push(`${file}: ${env.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("detects the offending shape, so the guard above cannot pass vacuously", () => {
    const seeded = [
      "jobs:",
      "  a-job:",
      "    runs-on: ubuntu-latest",
      "    env:",
      "      X: ${{ runner.temp }}/thing",
      "    steps:",
      "      - run: true",
    ].join("\n");
    expect(jobLevelEnvBodies(seeded).some((e) => /\$\{\{\s*runner\./.test(e))).toBe(true);
  });
});

/**
 * Host provisioning, bound to the constants it exists to satisfy.
 *
 * `e2e/live` carries two host-conformance tests that are deliberately NOT
 * `@live`-gated — they need no auth and no network, only a real binary:
 * `versionRangeGate.test.ts` requires a real `claude --version` inside the
 * accepted range, and `sandboxSelftestHarness.test.ts` requires real `bwrap`
 * confinement to pass. A stock GitHub runner has neither, and the first CI run
 * of this chain failed on exactly those two of 63 tests.
 *
 * The CLI pin is asserted against `TESTED_ENGINE_VERSION` rather than against a
 * literal, because a workflow pinning some OTHER in-range version would still
 * go green while quietly testing an engine the spike suite never validated —
 * and would reintroduce the PATH-vs-SDK transport split `docs/engine-baseline.md`
 * flags as load-bearing.
 */
describe("release-e2e.yml provisions the host capabilities the offline leg asserts", () => {
  it("installs bubblewrap and socat before the harness step runs", () => {
    const provision = stepBlocks(workflow).filter((b) => b.includes("bubblewrap"));
    expect(provision).toHaveLength(1);
    expect(provision[0]).toMatch(/socat/);

    const order = (needle: string): number =>
      stepBlocks(workflow).findIndex((b) => b.includes(needle));
    expect(order("bubblewrap")).toBeLessThan(order("npm run test:e2e:release-evidence"));
  });

  it("pins the Claude CLI to TESTED_ENGINE_VERSION, not merely to something in range", () => {
    const install = stepBlocks(workflow).filter((b) => b.includes("@anthropic-ai/claude-code@"));
    expect(install).toHaveLength(1);
    const pinned = /@anthropic-ai\/claude-code@(\d+\.\d+\.\d+)/.exec(install[0] ?? "")?.[1];
    expect(pinned).toBe(TESTED_ENGINE_VERSION);
  });

  it("keeps that pin inside the accepted engine range, so the gate can reach a verdict", () => {
    const triple = (v: string): number[] => v.split(".").map(Number);
    const cmp = (a: string, b: string): number => {
      const [x, y] = [triple(a), triple(b)];
      for (let i = 0; i < 3; i += 1) {
        const d = (x[i] ?? 0) - (y[i] ?? 0);
        if (d !== 0) return d;
      }
      return 0;
    };
    expect(cmp(TESTED_ENGINE_VERSION, ACCEPTED_ENGINE_VERSION_RANGE.min)).toBeGreaterThanOrEqual(0);
    expect(cmp(TESTED_ENGINE_VERSION, ACCEPTED_ENGINE_VERSION_RANGE.max)).toBeLessThanOrEqual(0);
  });
});
