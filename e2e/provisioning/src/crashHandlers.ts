/**
 * roadmap/23-release-hardening.md work item 2's "guaranteed-teardown"
 * requirement needs more than a `try/finally`: a `try/finally` only runs
 * when the JS call stack unwinds through an exception or a normal return,
 * but a forced abort delivered as an OS signal (SIGINT/SIGTERM from a CI
 * cancel, an operator Ctrl-C, a supervisor kill) or an escaped
 * uncaught/unhandled error never unwinds the `provisionAndRun` stack frame
 * at all — Node just keeps running until something else terminates it.
 * This module is the bash-`trap ... EXIT`-equivalent "trap-style cleanup"
 * the work item calls for: it registers process-level listeners so cleanup
 * still runs on those paths, mirroring `docker/jira-datacenter/smoke-test.sh`'s
 * own `trap cleanup EXIT` pattern at the Node-process level instead of a
 * shell subprocess's.
 */

export type Cleanup = () => Promise<void>;

export interface CrashHandlerOptions {
  /** Injectable in place of `process.exit`, so unit tests never actually terminate the test runner. */
  readonly exit?: (code: number) => void;
  /** Signals to trap. Defaults to SIGINT and SIGTERM. */
  readonly signals?: readonly NodeJS.Signals[];
}

export interface RegisteredCrashHandlers {
  /** Removes every listener this call installed. Idempotent. */
  readonly unregister: () => void;
  /** For tests/inspection: what triggered cleanup, if anything yet has. */
  readonly triggeredBy: () => string | undefined;
}

const DEFAULT_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

/**
 * Registers process-level crash traps that invoke `cleanup` exactly once,
 * no matter which of signal / uncaughtException / unhandledRejection fires
 * first. Returns an `unregister()` so a normal, successful run can remove
 * the listeners again once its own `try/finally` has already torn down
 * cleanly (avoiding listener buildup across many sequential runs in the
 * same process, e.g. a test file that provisions several environments).
 */
export function registerCrashHandlers(
  cleanup: Cleanup,
  options: CrashHandlerOptions = {},
): RegisteredCrashHandlers {
  const exit = options.exit ?? ((code: number): void => process.exit(code));
  const signals = options.signals ?? DEFAULT_SIGNALS;

  let handled = false;
  let triggeredBy: string | undefined;

  // `exit` is called from inside the SAME `handled`-guarded critical
  // section as `cleanup`, not from a separate `.then()` per trigger site —
  // otherwise two near-simultaneous triggers (e.g. a signal arriving right
  // as an uncaughtException fires) would each schedule their own `exit`
  // call even though `runCleanupOnce`'s early-return correctly ran
  // `cleanup()` only once, breaking the "exactly once" guarantee for exit.
  const runCleanupOnce = async (reason: string): Promise<void> => {
    if (handled) {
      return;
    }
    handled = true;
    triggeredBy = reason;
    try {
      await cleanup();
    } finally {
      exit(1);
    }
  };

  const signalHandlers = new Map<NodeJS.Signals, NodeJS.SignalsListener>();
  for (const signal of signals) {
    const handler: NodeJS.SignalsListener = (): void => {
      // `cleanup`'s own rejection is intentionally swallowed here (already
      // observed via `exit`'s `finally`-guaranteed call above) so it never
      // surfaces as an unhandled rejection that would re-trigger this same
      // module's own `onUnhandledRejection` listener below.
      void runCleanupOnce(`signal:${signal}`).catch(() => undefined);
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  const onUncaughtException = (): void => {
    void runCleanupOnce("uncaughtException").catch(() => undefined);
  };
  process.on("uncaughtException", onUncaughtException);

  const onUnhandledRejection = (): void => {
    void runCleanupOnce("unhandledRejection").catch(() => undefined);
  };
  process.on("unhandledRejection", onUnhandledRejection);

  const unregister = (): void => {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    process.removeListener("uncaughtException", onUncaughtException);
    process.removeListener("unhandledRejection", onUnhandledRejection);
  };

  return { unregister, triggeredBy: () => triggeredBy };
}
