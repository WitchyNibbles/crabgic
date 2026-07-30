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

/**
 * Acquires, ANNOUNCES the outcome, and holds until the parent closes stdin.
 *
 * WHY NOT A FIXED HOLD (2026-07-30). This used to acquire, sleep 300ms, release
 * and exit. The contention it was supposed to demonstrate was therefore assumed
 * rather than enforced: on a loaded machine the second child's cold Node start
 * can land entirely AFTER the first has released, so both legitimately acquire,
 * and the test reports `["ACQUIRED", "ACQUIRED"]` — a red run that means "no race
 * occurred", not "mutual exclusion failed". It was carried as a known flake for
 * weeks.
 *
 * Holding until stdin closes makes the overlap a fact rather than a hope: the
 * parent does not release either child until it has read BOTH outcomes, so both
 * decisions provably happened while both processes were alive. The exit
 * criterion this test exists for — exactly one of two real contending processes
 * acquires — is only meaningful if they genuinely contend.
 */
async function attemptAndHoldUntilStdinCloses(
  leaseDir: string,
  projectHash: string,
  pid: number,
): Promise<void> {
  let lease: Awaited<ReturnType<typeof Lease.acquire>> | undefined;
  let result: AttemptResult;
  try {
    lease = await Lease.acquire(leaseDir, projectHash, { pid, maxAcquireAttempts: 1 });
    result = { outcome: "ACQUIRED" };
  } catch (err) {
    result = { outcome: "DENIED", reason: err instanceof Error ? err.name : "unknown" };
  }

  process.stdout.write(
    `RESULT:${result.outcome}${result.reason !== undefined ? `:${result.reason}` : ""}\n`,
  );

  // The parent closes stdin once it has both outcomes in hand.
  await new Promise<void>((resolve) => {
    process.stdin.on("end", resolve);
    process.stdin.on("close", resolve);
    process.stdin.resume();
  });
  if (lease !== undefined) await lease.release();
}

// Entry point: only reached when this file is the process's own CLI entry
// (i.e. spawned directly), never when `attemptLeaseAcquire` above is
// imported by a normal vitest run.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , leaseDir, projectHash, pidArg] = process.argv;
  const pid = pidArg === undefined ? process.pid : Number(pidArg);
  await attemptAndHoldUntilStdinCloses(leaseDir ?? "", projectHash ?? "", pid);
}
