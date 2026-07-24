import { z } from "zod";

/**
 * roadmap/23-release-hardening.md work item 2: disposable-environment
 * provisioning + guaranteed-teardown scripts. This module defines the
 * validated, data-only configuration shape a caller passes to
 * `provisionAndRun` (see `./provisioning.ts`). Callback-shaped parameters
 * (the health probe, the caller-supplied test probe, the injectable
 * `ComposeRunner`) are deliberately kept OUT of this zod schema and passed
 * as separate function arguments instead — zod validates data at system
 * boundaries per this repo's own coding-style convention, but a closure has
 * no meaningful runtime shape for zod to check.
 */
export const ProvisionConfigSchema = z.object({
  /**
   * Unique identifier for this provisioning run. Used verbatim as the
   * `docker compose -p <runId>` project name, so every container/volume/
   * network Compose creates carries the `com.docker.compose.project=<runId>`
   * label — the label `verifyTornDown` and the teardown "second sweep"
   * (`ComposeRunner.pruneRun`) key off, independent of whether the original
   * compose file is still readable after a crash.
   */
  runId: z.string().min(1, "runId must be non-empty"),
  /** Absolute or cwd-relative path to the docker-compose.yml to bring up. */
  composeFile: z.string().min(1, "composeFile must be non-empty"),
  /**
   * Optional subset of service names (as declared in the compose file) that
   * must report healthy before `provisionAndRun` proceeds to the caller's
   * probe. Defaults to every service Compose reports for this project.
   */
  services: z.array(z.string().min(1)).optional(),
  /** Maximum time to wait for health before returning a `"timeout"` outcome. */
  healthTimeoutMs: z.number().int().positive().default(300_000),
  /** Poll interval while waiting for health. */
  healthPollIntervalMs: z.number().int().positive().default(2_000),
});

export type ProvisionConfigInput = z.input<typeof ProvisionConfigSchema>;
export type ProvisionConfig = z.output<typeof ProvisionConfigSchema>;

/** A caller-supplied application-level health check (e.g. Grafana's `/api/health`). */
export type HealthProbe = () => Promise<boolean>;

export interface ProbeContext {
  readonly runId: string;
  readonly config: ProvisionConfig;
}

/** The caller-supplied assertion/work to run once the environment is healthy. */
export type RunProbe<T> = (ctx: ProbeContext) => Promise<T>;

export type ProvisionOutcome<T> =
  | { readonly status: "ok"; readonly result: T }
  | { readonly status: "timeout"; readonly waitedMs: number }
  | { readonly status: "error"; readonly message: string };
