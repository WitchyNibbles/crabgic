import { spawn } from "node:child_process";

/**
 * Reusable kill/fault-injection harness (roadmap/04-journal-idempotency-
 * leases.md work item 7; "the phase-04 kill harness" 07's test plan names
 * as reused directly, and 05/13/23 reuse independently). Parameterized
 * over an ARBITRARY operation — a child-process command/args/env spec, or
 * a factory producing one per fault point — never coupled to journal
 * internals: `verify`/`recover` is entirely caller-supplied.
 *
 * Fault-point signalling mechanism (chosen, documented; roadmap/04 work
 * item 7 asks for one deterministic mechanism, picked over the IPC/
 * env-counter alternatives): the operation under test writes one line of
 * the form `FAULT_POINT_MARKER_PREFIX + <faultPointName>` to its own
 * stdout — see `signalFaultPoint` below — at each point where a crash
 * could plausibly matter. The harness watches the child's stdout for that
 * exact line and SIGKILLs the child the instant it observes it. This works
 * for ANY spawnable child process (no `fork()`/IPC channel required),
 * which is what makes it reusable across phases for arbitrary entry
 * scripts, not just ones written to use Node's `fork()` IPC.
 */

export const FAULT_POINT_MARKER_PREFIX = "__EO_KILL_HARNESS_FAULT__:";

/** Fixture-authoring helper: emits a fault-point marker line the harness watches for on this process's own stdout. */
export function signalFaultPoint(name: string): void {
  process.stdout.write(`${FAULT_POINT_MARKER_PREFIX}${name}\n`);
}

export interface KillHarnessRunContext {
  readonly faultPoint: string;
  readonly attemptIndex: number;
}

export interface KillHarnessOperationSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export type KillHarnessOperation =
  KillHarnessOperationSpec | ((ctx: KillHarnessRunContext) => KillHarnessOperationSpec);

export type KillHarnessKilledAt = "marker-observed" | "natural-exit" | "timeout-kill";

export interface KillHarnessVerdict {
  readonly recovered: boolean;
  readonly detail?: string | undefined;
}

export interface KillHarnessFaultPointReport {
  readonly faultPoint: string;
  readonly attemptIndex: number;
  readonly killedAt: KillHarnessKilledAt;
  readonly exitCode: number | null;
  readonly exitSignal: NodeJS.Signals | null;
  readonly recovered: boolean;
  readonly verdict: "pass" | "fail";
  readonly detail?: string | undefined;
}

export interface KillHarnessReport {
  readonly results: readonly KillHarnessFaultPointReport[];
  readonly allConverged: boolean;
}

export interface KillHarnessOptions {
  readonly verify: (ctx: KillHarnessRunContext) => Promise<KillHarnessVerdict> | KillHarnessVerdict;
  /** Safety timeout per fault point in case the marker never appears and the child hangs. Default 10_000. */
  readonly spawnTimeoutMs?: number;
  readonly onOperationOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
}

const DEFAULT_SPAWN_TIMEOUT_MS = 10_000;

function resolveSpec(
  operation: KillHarnessOperation,
  ctx: KillHarnessRunContext,
): KillHarnessOperationSpec {
  return typeof operation === "function" ? operation(ctx) : operation;
}

interface SingleRunOutcome {
  readonly killedAt: KillHarnessKilledAt;
  readonly exitCode: number | null;
  readonly exitSignal: NodeJS.Signals | null;
}

/**
 * Runs one child process for one fault point. Watches stdout for
 * `FAULT_POINT_MARKER_PREFIX + faultPoint`; on the first matching line,
 * SIGKILLs the child immediately. If the marker never appears before the
 * child exits on its own (`"natural-exit"`), or before `spawnTimeoutMs`
 * elapses (`"timeout-kill"`, the child is then force-killed as a safety
 * measure), that is recorded instead — `runKillHarness` treats either as
 * "this fault point was not genuinely exercised."
 */
async function runOneFaultPoint(
  spec: KillHarnessOperationSpec,
  ctx: KillHarnessRunContext,
  spawnTimeoutMs: number,
  onOperationOutput: KillHarnessOptions["onOperationOutput"],
): Promise<SingleRunOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env === undefined ? process.env : { ...process.env, ...spec.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const marker = `${FAULT_POINT_MARKER_PREFIX}${ctx.faultPoint}`;
    let stdoutBuffer = "";
    let killedAt: KillHarnessKilledAt | undefined;
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled || killedAt !== undefined) return;
      killedAt = "timeout-kill";
      child.kill("SIGKILL");
    }, spawnTimeoutMs);
    timeout.unref();

    function handleChunk(chunk: Buffer, stream: "stdout" | "stderr"): void {
      const text = chunk.toString("utf8");
      onOperationOutput?.(text, stream);
      if (stream !== "stdout") return;
      stdoutBuffer += text;
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (killedAt === undefined && line === marker) {
          killedAt = "marker-observed";
          child.kill("SIGKILL");
        }
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    }

    child.stdout?.on("data", (chunk: Buffer) => handleChunk(chunk, "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => handleChunk(chunk, "stderr"));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });

    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ killedAt: killedAt ?? "natural-exit", exitCode: code, exitSignal: signal });
    });
  });
}

export async function runKillHarness(
  operation: KillHarnessOperation,
  faultPoints: readonly string[],
  opts: KillHarnessOptions,
): Promise<KillHarnessReport> {
  const spawnTimeoutMs = opts.spawnTimeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS;
  const results: KillHarnessFaultPointReport[] = [];

  for (const [attemptIndex, faultPoint] of faultPoints.entries()) {
    const ctx: KillHarnessRunContext = { faultPoint, attemptIndex };
    const spec = resolveSpec(operation, ctx);
    const outcome = await runOneFaultPoint(spec, ctx, spawnTimeoutMs, opts.onOperationOutput);
    const verdictResult = await opts.verify(ctx);

    const exercised = outcome.killedAt === "marker-observed";
    const verdict: "pass" | "fail" = exercised && verdictResult.recovered ? "pass" : "fail";
    const detail =
      verdictResult.detail ??
      (exercised
        ? undefined
        : `fault point "${faultPoint}" marker was never observed (killedAt=${outcome.killedAt})`);

    results.push({
      faultPoint,
      attemptIndex,
      killedAt: outcome.killedAt,
      exitCode: outcome.exitCode,
      exitSignal: outcome.exitSignal,
      recovered: verdictResult.recovered,
      verdict,
      detail,
    });
  }

  return {
    results,
    allConverged: results.every((r) => r.verdict === "pass"),
  };
}
