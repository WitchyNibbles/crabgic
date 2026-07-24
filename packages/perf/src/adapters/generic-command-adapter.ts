import type { ProjectProfile } from "@eo/contracts";
import { NoBenchmarkCommandError } from "../errors.js";
import { runCommandWithResourceCapture } from "../measurement/command-runner.js";
import type { ResourceCaptureArtifact } from "../measurement/schema.js";
import type { BenchmarkAdapter, BenchmarkAdapterRunParams } from "./types.js";

/**
 * Resolves the declared benchmark command for `ecosystem` (or the first
 * ecosystem carrying one, when `ecosystem` is omitted) from a
 * `ProjectProfile` (12/02) — roadmap/15 §In scope, "Adapters": "generic
 * command benchmark (any `ProjectProfile`-declared benchmark command …)."
 * Throws `NoBenchmarkCommandError` (fail-closed, never a silent no-op
 * "benchmark") when nothing is declared.
 */
export function resolveDeclaredBenchmarkCommand(
  profile: ProjectProfile,
  ecosystem?: string,
): string {
  if (ecosystem !== undefined) {
    const match = profile.ecosystems.find((e) => e.ecosystem === ecosystem);
    if (match?.benchmarkCommand !== undefined) return match.benchmarkCommand;
    throw new NoBenchmarkCommandError(ecosystem);
  }
  const withCommand = profile.ecosystems.find((e) => e.benchmarkCommand !== undefined);
  if (withCommand?.benchmarkCommand !== undefined) return withCommand.benchmarkCommand;
  throw new NoBenchmarkCommandError(profile.ecosystems[0]?.ecosystem ?? "(none declared)");
}

export interface CreateGenericCommandAdapterOptions {
  readonly profile: ProjectProfile;
  readonly ecosystem?: string;
  readonly sampleIntervalMs?: number;
  readonly env?: NodeJS.ProcessEnv;
}

/** The generic-command `BenchmarkAdapter` — runs the `ProjectProfile`-declared benchmark command, measured via `../measurement/command-runner.ts`. */
export function createGenericCommandAdapter(
  options: CreateGenericCommandAdapterOptions,
): BenchmarkAdapter {
  const command = resolveDeclaredBenchmarkCommand(options.profile, options.ecosystem);
  return {
    name: "generic-command",
    async run(params: BenchmarkAdapterRunParams): Promise<ResourceCaptureArtifact> {
      return runCommandWithResourceCapture({
        command,
        cwd: params.cwd,
        ...(options.sampleIntervalMs !== undefined
          ? { sampleIntervalMs: options.sampleIntervalMs }
          : {}),
        ...(options.env !== undefined ? { env: options.env } : {}),
      });
    },
  };
}
