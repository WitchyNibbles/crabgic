/**
 * PRODUCER/CONSUMER BINDING FOR THE `engine-live` LANE'S CLI.
 *
 * `packages/plugin/src/live/*` resolves a bare `claude` from `PATH`
 * (`CLAUDE_CLI_BIN`). Nothing in `npm ci` puts one there: both
 * `@anthropic-ai/claude-agent-sdk` and its platform package report
 * `bin: undefined`, so no shim is linked, and a stock GitHub runner has no
 * `claude` at all. The `engine-live` workflow therefore has to provision it
 * — and until 2026-08-06 it did not, so a dispatch would have ENOENTed
 * every plugin case AFTER paying for the engine-claude files that share the
 * job (defect `06-engine-live-plugin-cli-unresolvable-on-ci`, five measured
 * links).
 *
 * These assertions read the REAL workflow file, not a fixture, so the
 * consumer (the live probes) and the producer (the workflow step) cannot
 * drift apart again with the suite still green. They run in the DEFAULT
 * per-push gate — unlike the `@live` suite itself, which nothing but an
 * owner-authorised dispatch can execute, and unlike
 * `e2e/release/src/releaseWorkflowWiring.test.ts`'s equivalent pin for
 * `release-e2e.yml`, which runs only in the release lane.
 *
 * NOTE ON WHAT IS AND IS NOT PROVEN HERE. This file proves the workflow is
 * WIRED to install an in-range, exactly-pinned CLI under the name the
 * probes resolve. It cannot prove the lane goes green: that needs an
 * owner-dispatched `engine-live` run, which spends the owner's
 * subscription. Nothing offline substitutes for it, and no box in
 * `roadmap/06`/`roadmap/10` may be ticked on the strength of this file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCEPTED_ENGINE_VERSION_RANGE, TESTED_ENGINE_VERSION } from "@crabgic/engine-claude";
import { CLAUDE_CLI_BIN } from "./live/claude-cli.js";
import { resolvePluginRoot } from "./plugin-root.js";

const REPO_ROOT = join(resolvePluginRoot(), "..", "..");
const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "engine-live.yml"), "utf8");

/**
 * Splits the `steps:` sequence into one text block per step — same shape as
 * `e2e/release/src/releaseWorkflowWiring.test.ts`'s splitter, and hand-rolled
 * for the same reason it gives: this package has no YAML dependency, and
 * adding one to assert three lines of CI wiring is not worth the
 * supply-chain surface. Steps are list items at indent 6 (`      - `);
 * everything indented further, plus blank lines, belongs to the open block.
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

const CLI_PACKAGE = "@anthropic-ai/claude-code";

function indexOfStepContaining(needle: string): number {
  return stepBlocks(workflow).findIndex((block) => block.includes(needle));
}

/** Compares two `MAJOR.MINOR.PATCH` strings; negative/zero/positive like any comparator. */
function cmp(a: string, b: string): number {
  const triple = (v: string): readonly number[] => v.split(".").map(Number);
  const [x, y] = [triple(a), triple(b)];
  for (let i = 0; i < 3; i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

describe("engine-live.yml provisions the CLI its plugin lane resolves from PATH", () => {
  it(`installs ${CLI_PACKAGE} in exactly one step`, () => {
    const install = stepBlocks(workflow).filter((block) => block.includes(`${CLI_PACKAGE}@`));
    expect(install).toHaveLength(1);
  });

  it("pins that install to TESTED_ENGINE_VERSION, never to a tag or a range", () => {
    // Asserted against the constant, not a second copy of the literal: a
    // workflow pinning some OTHER in-range version would still go green
    // while testing an engine the spike suite never validated, and would
    // reintroduce the PATH-vs-SDK transport split `docs/engine-baseline.md`
    // records as load-bearing. Pinning TESTED_ENGINE_VERSION puts both
    // transports on the same engine in this job.
    const [install] = stepBlocks(workflow).filter((block) => block.includes(`${CLI_PACKAGE}@`));
    const pinned = /@anthropic-ai\/claude-code@(\d+\.\d+\.\d+)/.exec(install ?? "")?.[1];
    expect(pinned).toBe(TESTED_ENGINE_VERSION);
  });

  it("never resolves the CLI through a dist-tag or a range specifier", () => {
    // `npm run check:engine-pin` cannot catch this: it scans workspace
    // package.json dependency fields, and a workflow is neither. The
    // registry is already PAST the accepted range (2.1.223 observed on
    // 2026-08-06), so `@latest` here would silently put the lane on an
    // unvalidated engine — the exact failure the engine-fact-drift ground
    // rule exists to prevent.
    //
    // EVERY MENTION OF THE PACKAGE IS CHECKED, not every `<name>@<spec>`
    // match — a review probe (2026-08-06) showed the narrower form has a
    // bypass: appending `npm install -g @anthropic-ai/claude-code` with NO
    // `@version` (npm resolves that to `latest`) inside the same step matches
    // neither a `<name>@` specifier scan nor the one-step count, so `latest`
    // could overwrite the pin with all nine assertions green.
    const mentions = [...workflow.matchAll(/@anthropic-ai\/claude-code(\S*)/g)].map((m) => m[1]!);
    expect(mentions.length).toBeGreaterThan(0);
    for (const suffix of mentions) {
      expect(suffix).toMatch(/^@\d+\.\d+\.\d+$/);
    }
  });

  it("CONTROL: TESTED_ENGINE_VERSION is itself inside the accepted range", () => {
    // Green from the start and reads no workflow at all — a relation between
    // two constants, kept because every assertion above that trusts
    // TESTED_ENGINE_VERSION as a proxy for "in range" depends on it. Labelled
    // so nobody counts it as evidence that this batch changed anything.
    expect(cmp(TESTED_ENGINE_VERSION, ACCEPTED_ENGINE_VERSION_RANGE.min)).toBeGreaterThanOrEqual(0);
    expect(cmp(TESTED_ENGINE_VERSION, ACCEPTED_ENGINE_VERSION_RANGE.max)).toBeLessThanOrEqual(0);
  });

  it("keeps the WORKFLOW'S OWN pinned literal inside the accepted engine version range", () => {
    // The control above proves a fact about the constants; this one reads the
    // file. They are different claims, and only this one goes red if the
    // workflow is edited to some out-of-range version.
    const [install] = stepBlocks(workflow).filter((block) => block.includes(`${CLI_PACKAGE}@`));
    const pinned = /@anthropic-ai\/claude-code@(\d+\.\d+\.\d+)/.exec(install ?? "")?.[1];
    expect(pinned).toBeDefined();
    expect(cmp(pinned!, ACCEPTED_ENGINE_VERSION_RANGE.min)).toBeGreaterThanOrEqual(0);
    expect(cmp(pinned!, ACCEPTED_ENGINE_VERSION_RANGE.max)).toBeLessThanOrEqual(0);
  });

  it(`proves the exact binary name the live probes resolve ("${CLAUDE_CLI_BIN}") is on PATH`, () => {
    // The defect was never "the wrong version was installed" — it was
    // ENOENT. A `command -v <bin>` in the provisioning step fails the job in
    // seconds, before any engine turn is paid for, if the package ever stops
    // linking that name.
    //
    // WHOLE-LINE ANCHORED, and this is not fussiness: the first draft used
    // `toContain("command -v claude")` and a reverse probe that renamed the
    // binary to `claude-code` left all 202 tests GREEN — the mutated line
    // contains the expected string as a prefix. An assertion that matches
    // both the fix and the bug is not a guard.
    const [install] = stepBlocks(workflow).filter((block) => block.includes(`${CLI_PACKAGE}@`));
    expect(install).toMatch(new RegExp(`^\\s*command -v ${CLAUDE_CLI_BIN}\\s*$`, "m"));
    expect(install).toMatch(new RegExp(`^\\s*${CLAUDE_CLI_BIN} --version\\s*$`, "m"));
  });

  it("installs the CLI BEFORE the step that runs the live suite", () => {
    const running = stepBlocks(workflow).filter((block) => block.includes("npm run test:live"));
    expect(running).toHaveLength(1);
    expect(indexOfStepContaining(`${CLI_PACKAGE}@`)).toBeGreaterThanOrEqual(0);
    expect(indexOfStepContaining(`${CLI_PACKAGE}@`)).toBeLessThan(
      indexOfStepContaining("npm run test:live"),
    );
  });

  it("does not carry a stale accepted-range comment", () => {
    // This file's header claimed `2.1.207–2.1.210` for two re-baselines
    // after the range moved — and it is the first thing whoever implements
    // the pin reads, so a stale upper bound is a live hazard rather than a
    // cosmetic one. Bound to the constant so it cannot go stale again.
    //
    // Scoped to version pairs sharing the ENGINE range's own `<major>.<minor>`
    // series, so that mentioning a different range in this header — the SDK's
    // `0.3.207`–`0.3.218`, say, which is deliberately NOT symmetric with the
    // CLI's — is not turned into a red by a guard about a different fact.
    const series = ACCEPTED_ENGINE_VERSION_RANGE.min.split(".").slice(0, 2).join("\\.");
    const ranges = [
      ...workflow.matchAll(new RegExp(`(${series}\\.\\d+)\\s*[–-]\\s*(${series}\\.\\d+)`, "g")),
    ];
    expect(ranges.length).toBeGreaterThan(0);
    for (const [, min, max] of ranges) {
      expect(min).toBe(ACCEPTED_ENGINE_VERSION_RANGE.min);
      expect(max).toBe(ACCEPTED_ENGINE_VERSION_RANGE.max);
    }
  });
});

describe("the live lane stops spending on the first failure", () => {
  const rootManifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    readonly scripts: Readonly<Record<string, string>>;
  };

  it("`test:live` bails, so one lane's failure cannot spend the other lane's budget", () => {
    // Measured in the defect record: `plugin-load.live.test.ts` ran FIRST of
    // the 17 files and `Test Files 17 failed (17)` — vitest does not order
    // files by which `include` pattern matched them, and without `--bail`
    // every remaining file authenticates and spends regardless of what
    // already failed.
    expect(rootManifest.scripts["test:live"]).toMatch(/--bail[= ]1\b/);
  });

  it("CONTROL: still runs the live suite through its own config", () => {
    // Green before this batch and after it. Its job is to catch a `--bail`
    // edit that also broke the script — not to evidence anything this batch
    // changed.
    expect(rootManifest.scripts["test:live"]).toContain("vitest.live.config.ts");
  });
});
