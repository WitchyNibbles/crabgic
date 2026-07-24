import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { provisionAndRun } from "../src/provisioning.js";
import { FakeComposeRunner } from "../src/testing/fakeComposeRunner.js";
import { verifyTornDown } from "../src/verifyTornDown.js";

const execFile = promisify(execFileCb);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const JIRA_DC_ROOT = join(REPO_ROOT, "docker", "jira-datacenter");

/**
 * roadmap/23-release-hardening.md work item 2, "Verify the existing Jira DC
 * recipes are wired into the provisioning harness too": this suite proves
 * (a) the harness resolves the exact same compose file paths phase 19
 * shipped, without modifying them; (b) `docker compose config` — a
 * daemon-independent, read-only client-side operation, never a container
 * boot — accepts each file as-is; and (c) the harness's timeout path (using
 * the fake runner, since a real DC boot needs a multi-minute cold start plus
 * a trial license per phase 19's own honesty note) correctly reports
 * `"timeout"` and still tears down for a Jira-DC-shaped never-healthy
 * service, exactly like the roadmap's own worked example.
 */
describe("Jira Data Center recipes wired into the provisioning harness", () => {
  it.each(["10.3", "11.3"] as const)(
    "the %s docker-compose.yml exists at the path phase 19 shipped it at",
    (edition) => {
      const composeFile = join(JIRA_DC_ROOT, edition, "docker-compose.yml");
      expect(existsSync(composeFile)).toBe(true);
    },
  );

  it.each(["10.3", "11.3"] as const)(
    "docker compose accepts the %s recipe as valid config (no daemon required)",
    async (edition) => {
      const composeFile = join(JIRA_DC_ROOT, edition, "docker-compose.yml");
      // `docker compose config` is a client-side parse/merge — it never
      // contacts the daemon or starts a container, so this assertion holds
      // even in a CI runner with no Docker daemon at all.
      await expect(
        execFile("docker", ["compose", "-f", composeFile, "config", "--quiet"]),
      ).resolves.toBeDefined();
    },
  );

  it("a Jira-DC-shaped container that never reaches healthy times out and still tears down", async () => {
    const runner = new FakeComposeRunner();
    const runId = "jira-dc-10.3-timeout";
    // Jira DC's real boot is measured in minutes and gates on a trial
    // license this harness deliberately never supplies (phase 19's own
    // honesty note, mirrored here) — modeled via the fake runner's
    // never-healthy seam rather than an actual multi-minute live boot.
    runner.seedNeverHealthy(runId, "jira");

    const outcome = await provisionAndRun(
      {
        runId,
        composeFile: join(JIRA_DC_ROOT, "10.3", "docker-compose.yml"),
        services: ["jira"],
        healthTimeoutMs: 25,
        healthPollIntervalMs: 5,
      },
      undefined,
      async () => "unreachable — Jira DC never reports healthy without a license past this point",
      { runner },
    );

    expect(outcome.status).toBe("timeout");
    expect((await verifyTornDown(runId, runner)).tornDown).toBe(true);
  });
});
