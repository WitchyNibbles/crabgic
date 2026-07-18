import { Lease } from "../lease.js";

export interface AttemptResult {
  readonly outcome: "ACQUIRED" | "DENIED";
  readonly reason?: string;
}

/**
 * The attempt's core decision logic, factored out so it is directly
 * unit-testable IN-PROCESS (see `lease-acquire-attempt.test.ts`, which
 * calls this concurrently via `Promise.all` to exercise the same real
 * `Lease.acquire` O_EXCL race without paying for a real child process) as
 * well as exercised for real by this file's own entry point below, which
 * only runs when this file is executed directly as a spawned child
 * process (see `./prepare-runtime.ts` + `../lease.test.ts`'s
 * two-real-child-process contention test — the exit-criterion test).
 */
export async function attemptLeaseAcquire(
  leaseDir: string,
  projectHash: string,
  pid: number,
  holdMs: number,
): Promise<AttemptResult> {
  try {
    const lease = await Lease.acquire(leaseDir, projectHash, { pid, maxAcquireAttempts: 1 });
    await new Promise<void>((resolve) => setTimeout(resolve, holdMs));
    await lease.release();
    return { outcome: "ACQUIRED" };
  } catch (err) {
    return { outcome: "DENIED", reason: err instanceof Error ? err.name : "unknown" };
  }
}

// Entry point: only reached when this file is the process's own CLI entry
// (i.e. spawned directly), never when `attemptLeaseAcquire` above is
// imported by a normal vitest run.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , leaseDir, projectHash, pidArg] = process.argv;
  const pid = pidArg === undefined ? process.pid : Number(pidArg);
  const result = await attemptLeaseAcquire(leaseDir ?? "", projectHash ?? "", pid, 300);
  process.stdout.write(
    `RESULT:${result.outcome}${result.reason !== undefined ? `:${result.reason}` : ""}\n`,
  );
}
