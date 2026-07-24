import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import type { ComposeRunner, ContainerStatus, SurvivingResources } from "../composeRunner.js";
import type { ProvisionConfig } from "../types.js";

const execFile = promisify(execFileCb);

const LABEL_PREFIX = "com.docker.compose.project=";
const MAX_BUFFER = 16 * 1024 * 1024;

async function docker(args: readonly string[]): Promise<string> {
  const { stdout } = await execFile("docker", [...args], { maxBuffer: MAX_BUFFER });
  return stdout;
}

function linesOf(stdout: string): readonly string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function normalizeState(raw: string | undefined): ContainerStatus["state"] {
  switch ((raw ?? "").toLowerCase()) {
    case "running":
      return "running";
    case "exited":
      return "exited";
    case "created":
      return "created";
    case "restarting":
      return "restarting";
    default:
      return "unknown";
  }
}

function normalizeHealth(raw: string | undefined): ContainerStatus["health"] {
  switch ((raw ?? "").toLowerCase()) {
    case "healthy":
      return "healthy";
    case "unhealthy":
      return "unhealthy";
    case "starting":
      return "starting";
    default:
      return "none";
  }
}

interface RawComposePsEntry {
  readonly Service?: string;
  readonly Name?: string;
  readonly ID?: string;
  readonly State?: string;
  readonly Health?: string;
}

/**
 * `docker compose ps --format json` output shape varies across Compose v2
 * releases: some print a single JSON array, others print newline-delimited
 * JSON (one object per line). This tolerates either without asserting a
 * specific Compose patch version (never asserted here; that is
 * `docs/engine-baseline.md`-owned territory for the Claude Code engine, not
 * for this Compose CLI wrapper).
 */
function parseComposePs(stdout: string): readonly ContainerStatus[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return [];
  }
  let entries: readonly RawComposePsEntry[];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    entries = Array.isArray(parsed)
      ? (parsed as RawComposePsEntry[])
      : [parsed as RawComposePsEntry];
  } catch {
    entries = linesOf(trimmed).flatMap((line) => {
      try {
        return [JSON.parse(line) as RawComposePsEntry];
      } catch {
        return [];
      }
    });
  }
  return entries.map((entry) => ({
    service: entry.Service ?? "unknown",
    containerId: entry.ID ?? entry.Name ?? "unknown",
    state: normalizeState(entry.State),
    health: normalizeHealth(entry.Health),
  }));
}

/**
 * Real `ComposeRunner` (roadmap/23 work item 2) — actual `docker compose`
 * child-process calls. Never imported by the default (non-`@live`) test
 * gate; exercised only by `provisioning.grafana-oss.live.test.ts` and by
 * real callers. Excluded from the harness's unit-test coverage denominator
 * (`vitest.config.ts`'s `coverage.exclude: ["src/live/**"]`), mirroring this
 * repo's own established convention for engine-facing live-only code
 * (`packages/*\/src/live/**`).
 */
export class RealComposeRunner implements ComposeRunner {
  async up(config: ProvisionConfig): Promise<void> {
    await docker(["compose", "-f", config.composeFile, "-p", config.runId, "up", "-d"]);
  }

  async ps(config: ProvisionConfig): Promise<readonly ContainerStatus[]> {
    const stdout = await docker([
      "compose",
      "-f",
      config.composeFile,
      "-p",
      config.runId,
      "ps",
      "--format",
      "json",
    ]);
    return parseComposePs(stdout);
  }

  async down(config: ProvisionConfig): Promise<void> {
    await docker([
      "compose",
      "-f",
      config.composeFile,
      "-p",
      config.runId,
      "down",
      "-v",
      "--remove-orphans",
    ]);
  }

  async pruneRun(runId: string): Promise<void> {
    const label = `${LABEL_PREFIX}${runId}`;
    const [containers, volumes, networks] = await Promise.all([
      linesOf(await docker(["ps", "-a", "-q", "--filter", `label=${label}`])),
      linesOf(await docker(["volume", "ls", "-q", "--filter", `label=${label}`])),
      linesOf(await docker(["network", "ls", "-q", "--filter", `label=${label}`])),
    ]);
    for (const id of containers) {
      await docker(["rm", "-f", id]).catch(() => undefined);
    }
    for (const name of volumes) {
      await docker(["volume", "rm", "-f", name]).catch(() => undefined);
    }
    for (const id of networks) {
      await docker(["network", "rm", id]).catch(() => undefined);
    }
  }

  async listSurviving(runId: string): Promise<SurvivingResources> {
    const label = `${LABEL_PREFIX}${runId}`;
    const [containers, volumes, networks] = await Promise.all([
      linesOf(await docker(["ps", "-a", "-q", "--filter", `label=${label}`])),
      linesOf(await docker(["volume", "ls", "-q", "--filter", `label=${label}`])),
      linesOf(await docker(["network", "ls", "-q", "--filter", `label=${label}`])),
    ]);
    return { containers, volumes, networks };
  }
}
