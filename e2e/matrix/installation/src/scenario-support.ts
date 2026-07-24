/**
 * Small, pure, directly-unit-testable guards shared by every scenario file
 * — factored out so each scenario's own "setup didn't reach the expected
 * real-installer state" / "the scenario's own assertion failed" branches
 * are exercised via direct unit tests (both taken AND not-taken) rather
 * than only ever hit on the never-supposed-to-happen side of a live,
 * always-passing integration run.
 */

export class ScenarioSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioSetupError";
  }
}

/** Throws `ScenarioSetupError` if `actual !== expected` — every scenario's own "did the real installer call I depend on for setup actually land in the state I need" guard. */
export function requireStatus(actual: string, expected: string, scenarioLabel: string): void {
  if (actual !== expected) {
    throw new ScenarioSetupError(
      `${scenarioLabel} scenario setup failed: expected status="${expected}", got "${actual}"`,
    );
  }
}

export class ScenarioAssertionError extends Error {
  constructor(scenarioName: string, detail: string) {
    super(`${scenarioName}: ${detail}`);
    this.name = "ScenarioAssertionError";
  }
}

/** Throws `ScenarioAssertionError` if `passed` is `false` — every scenario's own terminal pass/fail gate. */
export function requirePassed(passed: boolean, scenarioName: string, detail: string): void {
  if (!passed) {
    throw new ScenarioAssertionError(scenarioName, detail);
  }
}

/** The `action` a `--json` outcome list reports for `relPath`, or `"MISSING"` if no entry names that path at all (never supposed to happen against a real installer run, but never silently swallowed either). */
export function findOutcomeAction(
  outcomes: readonly { readonly relPath: string; readonly action: string }[],
  relPath: string,
): string {
  return outcomes.find((o) => o.relPath === relPath)?.action ?? "MISSING";
}
