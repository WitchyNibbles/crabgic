import type { ComposeRunner, ContainerStatus, SurvivingResources } from "../composeRunner.js";
import type { ProvisionConfig } from "../types.js";

interface RunState {
  up: boolean;
  /** Services that should never report healthy — models a heavy container (e.g. Jira DC) that never finishes booting. */
  neverHealthy: Set<string>;
  containers: Map<string, ContainerStatus>;
  volumes: Set<string>;
  networks: Set<string>;
  /**
   * Simulates a vendor/Compose bug where `down` alone leaves a volume
   * behind — this is exactly the gap `pruneRun`'s label-scoped second sweep
   * exists to close. Only `pruneRun` (not `down`) removes it in this fake.
   */
  downLeavesVolumeBehind: boolean;
  downCallCount: number;
  pruneCallCount: number;
}

/**
 * In-memory `ComposeRunner` for the provisioning harness's unit tests
 * (roadmap/23 work item 2: "the unit tests don't need a live daemon"). No
 * `docker`/`docker compose` binary is ever invoked — every method mutates a
 * plain in-memory map keyed by `runId`, scoped by the same
 * `com.docker.compose.project=<runId>` labeling convention the real runner
 * uses, so `listSurviving`/`verifyTornDown` behave identically in tests and
 * in production.
 */
export class FakeComposeRunner implements ComposeRunner {
  private readonly runs = new Map<string, RunState>();

  private stateFor(runId: string): RunState {
    const existing = this.runs.get(runId);
    if (existing) {
      return existing;
    }
    const created: RunState = {
      up: false,
      neverHealthy: new Set(),
      containers: new Map(),
      volumes: new Set(),
      networks: new Set(),
      downLeavesVolumeBehind: false,
      downCallCount: 0,
      pruneCallCount: 0,
    };
    this.runs.set(runId, created);
    return created;
  }

  /** Test seam: mark one or more services as never reaching a healthy state. */
  seedNeverHealthy(runId: string, ...services: readonly string[]): void {
    const state = this.stateFor(runId);
    for (const service of services) {
      state.neverHealthy.add(service);
    }
  }

  /** Test seam: simulate a `down` that leaves one labeled volume behind. */
  seedDownLeavesVolumeBehind(runId: string): void {
    this.stateFor(runId).downLeavesVolumeBehind = true;
  }

  /** Test seam: inspect how many times `down`/`pruneRun` were actually invoked. */
  callCounts(runId: string): { readonly down: number; readonly prune: number } {
    const state = this.stateFor(runId);
    return { down: state.downCallCount, prune: state.pruneCallCount };
  }

  async up(config: ProvisionConfig): Promise<void> {
    const state = this.stateFor(config.runId);
    state.up = true;
    state.volumes.add(`${config.runId}_default-volume`);
    state.networks.add(`${config.runId}_default-network`);
    const services = config.services ?? ["service"];
    for (const service of services) {
      state.containers.set(service, {
        service,
        containerId: `${config.runId}-${service}-container`,
        state: "running",
        health: state.neverHealthy.has(service) ? "starting" : "healthy",
      });
    }
  }

  async ps(config: ProvisionConfig): Promise<readonly ContainerStatus[]> {
    const state = this.stateFor(config.runId);
    return [...state.containers.values()];
  }

  async down(config: ProvisionConfig): Promise<void> {
    const state = this.stateFor(config.runId);
    state.downCallCount += 1;
    state.up = false;
    state.containers.clear();
    state.networks.clear();
    if (state.downLeavesVolumeBehind) {
      // Deliberately incomplete — mirrors a real-world `down -v` that fails
      // to remove a volume still referenced elsewhere. `pruneRun` below is
      // the harness's answer to exactly this case.
      return;
    }
    state.volumes.clear();
  }

  async pruneRun(runId: string): Promise<void> {
    const state = this.stateFor(runId);
    state.pruneCallCount += 1;
    state.containers.clear();
    state.volumes.clear();
    state.networks.clear();
  }

  async listSurviving(runId: string): Promise<SurvivingResources> {
    const state = this.stateFor(runId);
    return {
      containers: [...state.containers.values()].map((c) => c.containerId),
      volumes: [...state.volumes],
      networks: [...state.networks],
    };
  }
}
