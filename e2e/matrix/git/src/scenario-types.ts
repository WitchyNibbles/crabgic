/** One normalized scenario outcome, shared across every scenario file — what `evidence.ts` turns into an `EvidenceRecord` and what each scenario's own test asserts on. */
export interface ScenarioOutcome {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
  /** The exact Git object id this outcome was captured against. */
  readonly objectId: string;
}

export class ScenarioAssertionError extends Error {
  constructor(scenarioName: string, detail: string) {
    super(`${scenarioName}: ${detail}`);
    this.name = "ScenarioAssertionError";
  }
}

/** Throws `ScenarioAssertionError` if `passed` is `false` — every scenario's own terminal pass/fail gate (mirrors `e2e/matrix/installation/src/scenario-support.ts`'s identical helper). */
export function requirePassed(passed: boolean, scenarioName: string, detail: string): void {
  if (!passed) {
    throw new ScenarioAssertionError(scenarioName, detail);
  }
}

/** The `EvidenceRecord.exitStatus` every scenario's own evidence-emission call derives from its `passed` boolean — factored out of each call site's own inline ternary so both branches are covered by one direct unit test (`test/scenario-types.test.ts`) rather than only ever taking the `0` side across every live, always-passing scenario run. */
export function exitStatusFor(passed: boolean): 0 | 1 {
  return passed ? 0 : 1;
}
