import type { ProvisionConfig } from "./types.js";

export interface ContainerStatus {
  readonly service: string;
  readonly containerId: string;
  readonly state: "running" | "exited" | "created" | "restarting" | "unknown";
  readonly health: "healthy" | "unhealthy" | "starting" | "none";
}

export interface SurvivingResources {
  readonly containers: readonly string[];
  readonly volumes: readonly string[];
  readonly networks: readonly string[];
}

/**
 * Injectable seam between the provisioning harness and actual `docker
 * compose`/`docker` invocations (roadmap/23 work item 2: "Model the actual
 * docker/compose calls behind an injectable runner interface so the unit
 * tests don't need a live daemon"). `./testing/fakeComposeRunner.ts`
 * implements this in-memory for unit tests; `./live/realComposeRunner.ts`
 * implements it against a real Docker daemon for the `@live` integration
 * test and for actual use.
 */
export interface ComposeRunner {
  /** `docker compose -f <composeFile> -p <runId> up -d`. */
  up(config: ProvisionConfig): Promise<void>;
  /** Current per-service container status for this run. */
  ps(config: ProvisionConfig): Promise<readonly ContainerStatus[]>;
  /**
   * `docker compose -f <composeFile> -p <runId> down -v --remove-orphans`.
   * MUST be safe to call even if `up` never completed or partially failed.
   */
  down(config: ProvisionConfig): Promise<void>;
  /**
   * Best-effort second sweep, independent of the compose file: removes any
   * container/volume/network still carrying the
   * `com.docker.compose.project=<runId>` label. This is the "guaranteed"
   * half of guaranteed teardown — it works even if the compose file is gone,
   * unreadable, or `down` itself only partially completed.
   */
  pruneRun(runId: string): Promise<void>;
  /** What (if anything) still exists for this run, by label. */
  listSurviving(runId: string): Promise<SurvivingResources>;
}
