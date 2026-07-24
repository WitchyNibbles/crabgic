import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  ResourceCaptureArtifactSchema,
  type ResourceCaptureArtifact,
} from "../measurement/schema.js";
import type { BenchmarkAdapter, BenchmarkAdapterRunParams } from "./types.js";

/**
 * Purpose-built Node benchmark harness — roadmap/15 §In scope, "Adapters":
 * "… + a purpose-built Node harness." Unlike the generic-command adapter
 * (best-effort `/proc` sampling of an arbitrary external process), this
 * harness spawns a small, self-contained runner script that `import()`s
 * the caller-named benchmark module, times its default (or named) export,
 * and self-reports EXACT `getrusage(RUSAGE_SELF)` figures via
 * `process.resourceUsage()` (`../measurement/rusage.ts`'s own wrapper,
 * inlined here as a child-process one-liner since the child is a
 * DIFFERENT Node process than this package's own) — no `/proc` polling
 * race is possible, because the benchmarked process measures itself at
 * the precise moment its own run ends.
 *
 * NETWORK-BINDING NOTE (roadmap/15 §Risks & open questions,
 * "allowLocalBinding"): this harness itself never binds a local port — it
 * only `import()`s and calls a function in-process. If a CALLER's
 * benchmarked module itself opens a local listening socket (e.g. to
 * benchmark an HTTP server's own hot path), that bind happens inside the
 * spawned child process, which — once wired through a real sandboxed
 * worker execution — runs under the reference sandbox profile's
 * `allowLocalBinding: false` default (`@eo/engine-core`'s
 * `CompiledWorkerProfile.sandbox.network.allowLocalBinding`) and would
 * need an explicit, approval-visible `AuthorizationEnvelope` grant (11) to
 * succeed. This adapter does NOT request or silently assume that grant —
 * a caller benchmarking a local-listening-socket workload must arrange
 * that grant explicitly through 11's approval flow; this is documented
 * here, never silently defaulted on.
 */
export interface CreateNodeHarnessAdapterOptions {
  /** Absolute path to the benchmark module — CommonJS or ESM, resolved via `import()`. */
  readonly modulePath: string;
  /** Named export to call (default: `"default"`). Must be a zero-argument function, sync or async. */
  readonly exportName?: string;
  readonly nodeExecutable?: string;
}

function buildHarnessScript(modulePath: string, exportName: string): string {
  const moduleUrl = pathToFileURL(modulePath).href;
  return (
    `const mod = await import(${JSON.stringify(moduleUrl)});` +
    `const fn = mod[${JSON.stringify(exportName)}];` +
    `if (typeof fn !== "function") { throw new Error("node-harness: no callable export " + ${JSON.stringify(exportName)}); }` +
    `const start = process.hrtime.bigint();` +
    `await fn();` +
    `const end = process.hrtime.bigint();` +
    `const usage = process.resourceUsage();` +
    `process.stdout.write(JSON.stringify({` +
    `wallTimeMs: Number(end - start) / 1e6,` +
    `cpuUserMs: usage.userCPUTime / 1000,` +
    `cpuSystemMs: usage.systemCPUTime / 1000,` +
    `maxRssKb: usage.maxRSS,` +
    `}));`
  );
}

interface HarnessSelfReport {
  readonly wallTimeMs: number;
  readonly cpuUserMs: number;
  readonly cpuSystemMs: number;
  readonly maxRssKb: number;
}

/** The Node-harness `BenchmarkAdapter` — see this file's own doc comment. */
export function createNodeHarnessAdapter(
  options: CreateNodeHarnessAdapterOptions,
): BenchmarkAdapter {
  const exportName = options.exportName ?? "default";
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const script = buildHarnessScript(options.modulePath, exportName);
  const commandLabel = `node-harness: ${options.modulePath}#${exportName}`;

  return {
    name: "node-harness",
    async run(params: BenchmarkAdapterRunParams): Promise<ResourceCaptureArtifact> {
      const child = spawn(nodeExecutable, ["--input-type=module", "-e", script], {
        cwd: params.cwd,
        env: process.env,
      });

      let stdout = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      const exitCode = await new Promise<number>((resolve) => {
        child.on("exit", (code) => resolve(code ?? 0));
        child.on("error", () => resolve(-1));
      });

      let report: HarnessSelfReport | undefined;
      try {
        report = JSON.parse(stdout) as HarnessSelfReport;
      } catch {
        report = undefined;
      }

      return ResourceCaptureArtifactSchema.parse({
        command: commandLabel,
        wallTimeMs: report?.wallTimeMs ?? 0,
        cpuUserMs: report?.cpuUserMs ?? 0,
        cpuSystemMs: report?.cpuSystemMs ?? 0,
        peakRssKb: report?.maxRssKb ?? 0,
        exitCode,
      });
    },
  };
}
