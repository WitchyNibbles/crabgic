import type { ComposeRunner } from "./composeRunner.js";
import { registerCrashHandlers, type CrashHandlerOptions } from "./crashHandlers.js";
import {
  ProvisionConfigSchema,
  type HealthProbe,
  type ProvisionConfigInput,
  type ProvisionOutcome,
  type RunProbe,
} from "./types.js";

export interface ProvisionDeps {
  /** Injectable seam (roadmap/23 work item 2) — defaults to the real runner in production use. */
  readonly runner: ComposeRunner;
  readonly crashHandlerOptions?: CrashHandlerOptions;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function allServicesHealthy(
  config: ReturnType<typeof ProvisionConfigSchema.parse>,
  runner: ComposeRunner,
): Promise<boolean> {
  const statuses = await runner.ps(config);
  const expected = config.services ?? statuses.map((s) => s.service);
  if (expected.length === 0) {
    return false;
  }
  return expected.every((serviceName) => {
    const status = statuses.find((s) => s.service === serviceName);
    if (!status) {
      return false;
    }
    return status.health === "healthy" || (status.health === "none" && status.state === "running");
  });
}

async function waitForHealthy(
  config: ReturnType<typeof ProvisionConfigSchema.parse>,
  runner: ComposeRunner,
  healthProbe: HealthProbe | undefined,
): Promise<boolean> {
  const deadline = Date.now() + config.healthTimeoutMs;
  for (;;) {
    const healthy = healthProbe
      ? await healthProbe().catch(() => false)
      : await allServicesHealthy(config, runner);
    if (healthy) {
      return true;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return false;
    }
    await sleep(Math.min(config.healthPollIntervalMs, remaining));
  }
}

/**
 * Brings up a container set via the injected `ComposeRunner`, waits for
 * health (an app-level `healthProbe` when given — e.g. Grafana's
 * `/api/health` — otherwise Compose-reported container health), runs the
 * caller-supplied `probe`, and — the guaranteed-teardown contract this work
 * item exists for — ALWAYS tears down: a `try/finally` covers every normal
 * return/throw path, and `registerCrashHandlers` covers the paths a
 * `try/finally` structurally cannot (SIGINT/SIGTERM, an escaped
 * uncaught/unhandled error). Teardown itself is `down()` followed by
 * `pruneRun()`'s independent label-scoped sweep, so a partially-effective
 * `down()` is not the last line of defense.
 *
 * A container set that never reaches healthy (e.g. Jira Data Center's
 * multi-minute cold boot, or one requiring a license this harness
 * deliberately never supplies) resolves to `{ status: "timeout" }` rather
 * than throwing — teardown still runs via the same `finally`.
 */
export async function provisionAndRun<T>(
  configInput: ProvisionConfigInput,
  healthProbe: HealthProbe | undefined,
  probe: RunProbe<T>,
  deps: ProvisionDeps,
): Promise<ProvisionOutcome<T>> {
  const config = ProvisionConfigSchema.parse(configInput);
  const { runner } = deps;

  let tornDown = false;
  const teardown = async (): Promise<void> => {
    if (tornDown) {
      return;
    }
    tornDown = true;
    try {
      await runner.down(config);
    } finally {
      await runner.pruneRun(config.runId).catch(() => undefined);
    }
  };

  const { unregister } = registerCrashHandlers(teardown, deps.crashHandlerOptions);

  try {
    await runner.up(config);
    const healthy = await waitForHealthy(config, runner, healthProbe);
    if (!healthy) {
      return { status: "timeout", waitedMs: config.healthTimeoutMs };
    }
    const result = await probe({ runId: config.runId, config });
    return { status: "ok", result };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  } finally {
    await teardown();
    unregister();
  }
}
