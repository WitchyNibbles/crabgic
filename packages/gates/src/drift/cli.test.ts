import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DEBOUNCE_STATE_PATH,
  DEFAULT_PROPOSALS_OUTPUT_PATH,
  runDriftCiCli,
} from "./cli.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eo-drift-ci-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("runDriftCiCli — real fs I/O, scoped to its own state/output paths only", () => {
  it("green path: no env overrides -> no proposals, empty proposals file, non-red result", async () => {
    const debounceStatePath = join(dir, "debounce-state.json");
    const proposalsOutputPath = join(dir, "drift-proposals.json");

    const result = await runDriftCiCli({ debounceStatePath, proposalsOutputPath });
    expect(result.redCheck).toBe(false);

    const proposals = JSON.parse(await readFile(proposalsOutputPath, "utf-8")) as unknown[];
    expect(proposals).toEqual([]);
  });

  it("an observed jira version override drifts, debounced across two runs against the SAME persisted state file", async () => {
    const debounceStatePath = join(dir, "debounce-state.json");
    const proposalsOutputPath = join(dir, "drift-proposals.json");
    const previous = process.env["JIRA_OBSERVED_VERSION"];
    process.env["JIRA_OBSERVED_VERSION"] = "1001.0.0";
    try {
      const first = await runDriftCiCli({
        debounceStatePath,
        proposalsOutputPath,
        debounceThreshold: 2,
      });
      expect(first.redCheck).toBe(false);

      const second = await runDriftCiCli({
        debounceStatePath,
        proposalsOutputPath,
        debounceThreshold: 2,
      });
      expect(second.redCheck).toBe(true);

      const proposals = JSON.parse(await readFile(proposalsOutputPath, "utf-8")) as ReadonlyArray<{
        connector: string;
      }>;
      expect(proposals).toHaveLength(1);
      expect(proposals[0]?.connector).toBe("jira");
    } finally {
      if (previous === undefined) delete process.env["JIRA_OBSERVED_VERSION"];
      else process.env["JIRA_OBSERVED_VERSION"] = previous;
    }
  });

  it("a GRAFANA_OBSERVED_VERSION override drifts too", async () => {
    const debounceStatePath = join(dir, "debounce-state.json");
    const proposalsOutputPath = join(dir, "drift-proposals.json");
    const previous = process.env["GRAFANA_OBSERVED_VERSION"];
    process.env["GRAFANA_OBSERVED_VERSION"] = "14.0.0";
    try {
      const result = await runDriftCiCli({
        debounceStatePath,
        proposalsOutputPath,
        debounceThreshold: 1,
      });
      expect(result.redCheck).toBe(true);
    } finally {
      if (previous === undefined) delete process.env["GRAFANA_OBSERVED_VERSION"];
      else process.env["GRAFANA_OBSERVED_VERSION"] = previous;
    }
  });

  it("uses the documented default (outside the repo tree, under os.tmpdir()) when no explicit paths are supplied", async () => {
    const result = await runDriftCiCli({ debounceThreshold: 1 });
    expect(result.redCheck).toBe(false);
    expect(DEFAULT_DEBOUNCE_STATE_PATH).toContain("eo-drift-ci");
    expect(DEFAULT_PROPOSALS_OUTPUT_PATH).toContain("eo-drift-ci");
    const proposals = JSON.parse(
      await readFile(DEFAULT_PROPOSALS_OUTPUT_PATH, "utf-8"),
    ) as unknown[];
    expect(proposals).toEqual([]);
  });
});
