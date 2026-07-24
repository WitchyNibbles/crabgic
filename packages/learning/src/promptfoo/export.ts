import type { EvalCase } from "../eval/case-schema.js";

/**
 * Promptfoo config shapes — hand-modeled to match Promptfoo's own
 * documented `promptfooconfig.json` structure (`prompts`/`providers`/
 * `tests[].vars`/`tests[].assert`), per adaptation §2 row 12: "no
 * managed-eval dependency." This is a plain-object SHAPE, never an import
 * of the `promptfoo` package itself — `package.json` declares no such
 * dependency, and `../red-team/no-promptfoo-dependency.redteam.test.ts`
 * proves it. A caller who has the real `promptfoo` CLI installed can write
 * this object to `promptfooconfig.json` and run it unmodified; this
 * package never shells out to it, never adds a new CLI verb for it
 * (roadmap/22 §In scope: "optional Promptfoo adapter (package-internal
 * export, no new CLI verb)").
 */
export interface PromptfooAssertion {
  readonly type: "equals";
  readonly value: boolean;
}

export interface PromptfooTestCase {
  readonly description: string;
  readonly vars: Record<string, unknown>;
  readonly assert: readonly PromptfooAssertion[];
}

export interface PromptfooConfig {
  readonly description: string;
  readonly prompts: readonly string[];
  readonly providers: readonly string[];
  readonly tests: readonly PromptfooTestCase[];
}

/**
 * Exports a dev/held-out case set to Promptfoo's config shape. `prompts`
 * is a single placeholder template (`{{input}}`) — this package has no
 * opinion on prompt authoring, it only re-shapes already-built `EvalCase`s;
 * `providers` is left empty (a caller wires in whatever provider it
 * actually wants to grade against — never hardcoded here, since hardcoding
 * one would itself be exactly the "managed-eval dependency" adaptation §2
 * row 12 rules out).
 */
export function exportToPromptfooConfig(
  description: string,
  cases: readonly EvalCase[],
): PromptfooConfig {
  return {
    description,
    prompts: ["{{input}}"],
    providers: [],
    tests: cases.map((c) => ({
      description: c.id,
      vars: { input: c.input },
      assert: [{ type: "equals", value: c.expectedJudgment }],
    })),
  };
}
