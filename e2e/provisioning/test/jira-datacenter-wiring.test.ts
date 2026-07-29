import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { load as parseYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

import { provisionAndRun } from "../src/provisioning.js";
import { FakeComposeRunner } from "../src/testing/fakeComposeRunner.js";
import { verifyTornDown } from "../src/verifyTornDown.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const JIRA_DC_ROOT = join(REPO_ROOT, "docker", "jira-datacenter");

/**
 * roadmap/23-release-hardening.md work item 2, "Verify the existing Jira DC
 * recipes are wired into the provisioning harness too": this suite proves
 * (a) the harness resolves the exact same compose file paths phase 19
 * shipped, without modifying them; (b) each recipe genuinely describes the
 * service the harness will drive; and (c) the harness's timeout path (using
 * the fake runner, since a real DC boot needs a multi-minute cold start plus
 * a trial license per phase 19's own honesty note) correctly reports
 * `"timeout"` and still tears down for a Jira-DC-shaped never-healthy
 * service, exactly like the roadmap's own worked example.
 *
 * (b) USED TO SHELL OUT TO `docker compose config`, on the stated reasoning
 * that it is "a daemon-independent, read-only client-side operation ... so
 * this assertion holds even in a CI runner with no Docker daemon at all".
 * That reasoning is sound about the DAEMON and silent about the CLIENT: on a
 * host with no `docker` binary at all — a WSL distro without Docker Desktop
 * integration, for one — it fails, and it failed for a reason that says
 * nothing about the recipes. Worse, it broke this gate's own declared
 * invariant: `vitest.config.ts` states that this gate "never touches Docker
 * and is safe to run anywhere, including CI without a daemon", and one test
 * spawning the real binary made that false.
 *
 * So the two halves are separated by what they actually need. Here: parse the
 * recipe and assert the facts the HARNESS depends on — the service name it
 * drives, the image tag pinned to the edition, a healthcheck for
 * `provisionAndRun` to wait on, a named volume for teardown to remove. That
 * is host-independent and, on the questions this harness cares about, a
 * stronger assertion than `config --quiet`, which only proves the file parses
 * and merges. Docker's own schema conformance is proven where a `docker`
 * binary is legitimately assumed: `jira-datacenter-config.live.test.ts`.
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
    "the %s recipe describes the service the harness drives, with no Docker binary involved",
    (edition) => {
      const composeFile = join(JIRA_DC_ROOT, edition, "docker-compose.yml");
      const recipe = parseYaml(readFileSync(composeFile, "utf8")) as {
        services?: Record<string, unknown>;
        volumes?: Record<string, unknown>;
      };

      // The service name is not cosmetic: `provisionAndRun` is called with
      // `services: ["jira"]`, and the roadmap's worked example seeds
      // `seedNeverHealthy(runId, "jira")`. A rename here would break the
      // harness while `docker compose config` still reported the file valid.
      const jira = recipe.services?.jira as
        | {
            image?: string;
            healthcheck?: { test?: unknown };
            volumes?: string[];
          }
        | undefined;
      expect(jira, `the ${edition} recipe declares no "jira" service`).toBeDefined();

      // Pinned to the exact edition. An unpinned or drifted tag would boot a
      // different Jira than the one phase 19 recorded evidence against.
      expect(jira?.image).toBe(`atlassian/jira-software:${edition}`);

      // `provisionAndRun` waits for health and then tears down, so a recipe
      // with no healthcheck would make it wait on nothing, and one with no
      // named volume would leave state behind that `verifyTornDown` asserts is
      // gone.
      expect(jira?.healthcheck?.test).toBeDefined();
      expect(Object.keys(recipe.volumes ?? {}).length).toBeGreaterThan(0);
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
