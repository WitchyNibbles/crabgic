import { execFile as execFileCb } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFile = promisify(execFileCb);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const JIRA_DC_ROOT = join(REPO_ROOT, "docker", "jira-datacenter");

/**
 * `docker compose config` against the real Jira DC recipes — Docker's OWN
 * schema conformance, which nothing but Docker can decide.
 *
 * WHY IT MOVED HERE. This assertion lived in `jira-datacenter-wiring.test.ts`,
 * in the default gate, on the reasoning that `docker compose config` is "a
 * daemon-independent, read-only client-side operation ... so this assertion
 * holds even in a CI runner with no Docker daemon at all". That is correct
 * about the DAEMON and silent about the CLIENT: it still spawns the `docker`
 * BINARY, so on a host without one it fails for a reason that says nothing
 * about the recipes. It also contradicted the default gate's own declared
 * invariant — `vitest.config.ts` states that gate "never touches Docker and is
 * safe to run anywhere, including CI without a daemon".
 *
 * `@live` is the existing home for "needs a real Docker CLI", so it is now
 * here, beside the Grafana boot test, and excluded from the default gate by the
 * same `**{/}*.live.test.ts` pattern. NOT skipped-when-missing: a skip that
 * reports itself as a pass is how a gate stops meaning anything, and this
 * repository has the `@live` split precisely so an environment-dependent
 * assertion can be real where it runs rather than conditional everywhere.
 *
 * What the default gate keeps is the half that does not need Docker at all,
 * and it is the half this harness actually depends on: the service name it
 * drives, the pinned image tag, a healthcheck to wait on, a named volume to
 * tear down. `config --quiet` proves none of those — only that the file parses
 * and merges.
 *
 * Unlike the Grafana `@live` test, this one needs no image pull, no network and
 * no container: `config` is a local parse. A live Docker CLI is the whole
 * requirement.
 */
describe("@live Jira Data Center recipes — docker's own config validation", () => {
  it.each(["10.3", "11.3"] as const)(
    "docker compose accepts the %s recipe as valid config",
    async (edition) => {
      const composeFile = join(JIRA_DC_ROOT, edition, "docker-compose.yml");
      await expect(
        execFile("docker", ["compose", "-f", composeFile, "config", "--quiet"]),
      ).resolves.toBeDefined();
    },
  );
});
