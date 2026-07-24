import { spawn } from "node:child_process";
import { ResourceCaptureArtifactSchema, type ResourceCaptureArtifact } from "./schema.js";
import { ticksToMs } from "./proc-parser.js";
import { sampleProcessTree } from "./process-sampler.js";

export interface RunCommandWithResourceCaptureOptions {
  /** The command to run (a shell command line — e.g. `ProjectProfile.benchmarkCommand`). */
  readonly command: string;
  readonly cwd: string;
  /** How often to poll `/proc/<pid>/*` while the command runs, milliseconds. Default 20ms. */
  readonly sampleIntervalMs?: number;
  /**
   * Environment to run the child with. NEVER read back or embedded into the
   * returned `ResourceCaptureArtifact` (roadmap/15 §Critical correctness
   * points, "Secret-leakage") — passed straight through to `child_process`
   * for the child's OWN use (e.g. `PATH` so the command can even run),
   * with zero copy of it retained on the artifact this function returns.
   * Defaults to the current process's own environment.
   */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Runs `options.command` as a child process in `options.cwd`, measuring it
 * via best-effort `/proc` polling of its ENTIRE process tree while it runs
 * (roadmap/15 §In scope, "Resource capture") — see
 * `./process-sampler.ts`'s `sampleProcessTree` doc comment for why a
 * single pid is not sufficient under `{shell: true}`. `command` is stored
 * on the returned artifact as public, declared config (e.g.
 * `ProjectProfile.benchmarkCommand`) — never raw process argv, and the
 * artifact NEVER carries `env` in any form (see `./schema.ts`'s own
 * `.strict()` schema and `./secret-leakage.test.ts`).
 *
 * CPU/RSS figures are the MAX observed across every successful poll (CPU
 * ticks are monotonically non-decreasing for a live process, so the
 * highest tick count seen IS the most accurate available estimate — never
 * "whichever poll happened to resolve last," which would be a race).
 *
 * BEST-EFFORT LIMITATION (documented, not silently hidden): a command that
 * exits faster than one poll interval may yield zero non-zero /proc
 * samples, in which case `cpuUserMs`/`cpuSystemMs`/`peakRssKb` are
 * reported as `0` rather than thrown — a real measurement limitation for
 * very short-lived commands, carried forward in `docs/evidence/phase-15/
 * README.md`. `wallTimeMs` is always accurate regardless (measured
 * directly around the spawn/exit boundary, no `/proc` dependency).
 */
export async function runCommandWithResourceCapture(
  options: RunCommandWithResourceCaptureOptions,
): Promise<ResourceCaptureArtifact> {
  const intervalMs = options.sampleIntervalMs ?? 20;
  const startedAtMs = Date.now();

  const child = spawn(options.command, {
    cwd: options.cwd,
    shell: true,
    env: options.env ?? process.env,
    stdio: "ignore",
  });

  let maxUtimeTicks = 0;
  let maxStimeTicks = 0;
  let maxPeakRssKb = 0;
  let ioReadBytes: number | undefined;
  let ioWriteBytes: number | undefined;
  let polling = true;

  function absorb(sample: {
    utimeTicks: number;
    stimeTicks: number;
    peakRssKb: number;
    ioReadBytes?: number;
    ioWriteBytes?: number;
  }): void {
    maxUtimeTicks = Math.max(maxUtimeTicks, sample.utimeTicks);
    maxStimeTicks = Math.max(maxStimeTicks, sample.stimeTicks);
    maxPeakRssKb = Math.max(maxPeakRssKb, sample.peakRssKb);
    if (sample.ioReadBytes !== undefined)
      ioReadBytes = Math.max(ioReadBytes ?? 0, sample.ioReadBytes);
    if (sample.ioWriteBytes !== undefined)
      ioWriteBytes = Math.max(ioWriteBytes ?? 0, sample.ioWriteBytes);
  }

  async function pollLoop(): Promise<void> {
    while (polling) {
      if (child.pid !== undefined) {
        absorb(await sampleProcessTree(child.pid));
      }
      if (!polling) break;
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  const pollPromise = pollLoop();

  const exitCode = await new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", () => resolve(-1));
  });

  polling = false;
  // One last best-effort sample right at the exit boundary — the process
  // tree may already be gone by the time this resolves, which is fine
  // (sampleProcessTree degrades to all-zero for a vanished tree).
  if (child.pid !== undefined) {
    absorb(await sampleProcessTree(child.pid));
  }
  await pollPromise;

  const endedAtMs = Date.now();

  return ResourceCaptureArtifactSchema.parse({
    command: options.command,
    wallTimeMs: endedAtMs - startedAtMs,
    cpuUserMs: ticksToMs(maxUtimeTicks),
    cpuSystemMs: ticksToMs(maxStimeTicks),
    peakRssKb: maxPeakRssKb,
    ...(ioReadBytes !== undefined ? { ioReadBytes } : {}),
    ...(ioWriteBytes !== undefined ? { ioWriteBytes } : {}),
    exitCode,
  });
}
