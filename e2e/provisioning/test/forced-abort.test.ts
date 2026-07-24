import { describe, expect, it } from "vitest";

import { provisionAndRun } from "../src/provisioning.js";
import { FakeComposeRunner } from "../src/testing/fakeComposeRunner.js";
import { verifyTornDown } from "../src/verifyTornDown.js";

/**
 * roadmap/23-release-hardening.md work item 2's own fail-first criterion,
 * verbatim: "teardown-verification FAILs if a forced-abort leaves any
 * tenant/container alive." This test simulates a forced abort (a SIGTERM,
 * as a supervisor/CI cancel or an operator Ctrl-C would deliver) that
 * arrives strictly *mid-run* — after the environment is up and the probe
 * has started, but before the probe (and therefore `provisionAndRun`'s own
 * `try/finally`) would ever naturally resolve.
 *
 * `docs/evidence/phase-23/provisioning/forced-abort-failing.txt` records
 * this same test hung against a temporarily-reverted `provisioning.ts` with
 * `registerCrashHandlers` removed (only the ordinary `try/finally`
 * remained) — a `try/finally` cannot run until its own promise chain
 * settles, and a probe that never resolves means it never does, so the
 * signal is silently swallowed and the environment is never torn down.
 * `docs/evidence/phase-23/provisioning/forced-abort-passing.txt` records it
 * green against the real, crash-safe implementation checked in here.
 */
describe("forced abort mid-run (crash-safe teardown)", () => {
  it(
    "still tears down when a SIGTERM arrives while the probe is in flight",
    { timeout: 5_000 },
    async () => {
      const runner = new FakeComposeRunner();
      const runId = "forced-abort-1";
      let releaseProbe: (() => void) | undefined;
      const probeGate = new Promise<void>((resolve) => {
        releaseProbe = resolve;
      });
      let probeStarted = false;
      let exitCode: number | undefined;

      const outcomePromise = provisionAndRun(
        { runId, composeFile: "x.yml", healthPollIntervalMs: 5 },
        undefined,
        async () => {
          probeStarted = true;
          // Simulates real work in progress at the moment the abort lands —
          // this promise only ever settles if something outside this probe
          // resolves it, which nothing here does once we abandon it below.
          await probeGate;
          return "never reached in this scenario";
        },
        {
          runner,
          crashHandlerOptions: {
            exit: (code) => {
              exitCode = code;
            },
            signals: ["SIGTERM"],
          },
        },
      );

      await waitUntil(() => probeStarted);
      expect((await verifyTornDown(runId, runner)).tornDown).toBe(false);

      // The forced abort: a real deployment would receive this from the OS;
      // here it is emitted synthetically so the test never needs a live
      // subprocess to kill (roadmap/23 work item 2: "unit tests don't need
      // a live daemon"). `registerCrashHandlers` is the only thing standing
      // between this and a leaked environment.
      process.emit("SIGTERM");

      await waitForAssertion(async () => {
        const verification = await verifyTornDown(runId, runner);
        if (!verification.tornDown) {
          throw new Error("not torn down yet");
        }
      });

      // `exitCode` settles a few microtask ticks after teardown becomes
      // observable (the teardown promise chain still has to unwind back up
      // through `registerCrashHandlers`'s own `.then(() => exit(1))|); poll
      // for it rather than asserting the instant teardown is visible.
      await waitForAssertion(async () => {
        if (exitCode !== 1) {
          throw new Error("exit not called yet");
        }
      });

      // Release the never-resolving probe so this test's own promise chain
      // doesn't outlive the test (the outer `provisionAndRun` call's own
      // `finally` already ran teardown a second, harmless, idempotent time
      // once the abort-triggered teardown completed — teardown is
      // idempotent by design).
      releaseProbe?.();
      await outcomePromise;
    },
  );
});

async function waitUntil(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("condition never became true");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function waitForAssertion(assertion: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + 3_000;
  for (;;) {
    try {
      await assertion();
      return;
    } catch (err) {
      if (Date.now() > deadline) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}
