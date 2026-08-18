/**
 * T3 + T4 of `docs/evidence/phase-25/r7-plan-record.md` — the re-duplication
 * guard, and the two non-goals made executable.
 *
 * WHAT THIS EXISTS TO CATCH, stated as the failure rather than the rule. Before
 * this change set, `CPU_BUDGET_FRACTION = 0.01` was declared privately in BOTH
 * `idle-budget.integration.test.ts` and `heartbeat-scheduler.test.ts`, and every
 * test in this directory passed. Two copies of one budget is not a test failure
 * in any suite — it is a review finding, and review is exactly what this
 * repository has measured itself failing to catch repeatedly. Collapsing them
 * without this guard would leave the reappearance of a third copy equally
 * invisible.
 *
 * ⚠️ SCOPE IS HARD-CODED TO THIS DIRECTORY, AND THAT IS THE OWNER'S RULING, not
 * an implementation shortcut. `e2e/attestation/src/performanceContracts.ts:91`
 * carries a THIRD declaration of the same 0.01 threshold under a different name
 * (`SUPERVISOR_IDLE_CPU_FRACTION_BUDGET`). The owner ruled the collapse reaches
 * two sites, not three. A scan rooted any higher would silently grow into a
 * demand to merge that one, which is a different change set with a different
 * approval — so the root is fixed here, and this comment is why.
 *
 * Modelled on `../router/no-change-set-operation.test.ts:51-53`: a raw-text scan
 * rather than an AST-aware one, so a copy inside a comment counts too. That is
 * the conservative direction — a commented-out private copy is still a second
 * place a reader can take the number from.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CPU_BUDGET_FRACTION } from "./resource-probe.js";

/** T4/E5: the scan root, fixed at this directory. See the file header for why it may not be widened. */
const IDLE_BUDGET_DIR = fileURLToPath(new URL(".", import.meta.url));

/** The one file allowed to declare it — the production module the collapse moves it to. */
const SOLE_DECLARATION_FILE = "resource-probe.ts";

/**
 * The constant's name, ASSEMBLED rather than written, and that is the whole trick.
 *
 * ⚠️ TWO WRONG VERSIONS CAME FIRST, and the pair of them is the lesson. The first pattern was
 * the broad `<name>\s*=`, which is the correct rule — and it failed on this file's own source,
 * because writing that pattern as a regex literal puts the very text it hunts for into the file
 * doing the hunting. The second pattern "fixed" that by requiring a `const`/`let`/`var`
 * immediately before the name. That silenced the self-match and bought three false negatives:
 * `const OTHER = 1, CPU_BUDGET_FRACTION = 0.01;` (a comma-separated declaration list),
 * `function f(x, CPU_BUDGET_FRACTION = 0.01)` (a default parameter), and
 * `class A { CPU_BUDGET_FRACTION = 0.01; }` (a class field). All three are ordinary JavaScript,
 * none is a contrived evasion, and each would have reintroduced a second source of the budget
 * with this guard green.
 *
 * Assembling the name from fragments keeps the BROAD rule and removes the self-match: the
 * literal `CPU_BUDGET_FRACTION` followed by `=` never occurs in this file's text, because the
 * only places the name appears here are an import and two `expect(...)` calls, and neither is
 * followed by an assignment.
 *
 * Narrowing a pattern to escape a self-match is the move to distrust. The rule was right; the
 * spelling was the problem.
 */
const CONSTANT_NAME = ["CPU", "BUDGET", "FRACTION"].join("_");

/** Any assignment to that name — a declaration in any syntactic shape, not just `const NAME =`. */
const DECLARATION = new RegExp(CONSTANT_NAME + "\\s*=");

/**
 * Comments are stripped before matching, and this is a DEPARTURE from the design's note that a
 * raw scan should count a copy inside a comment too.
 *
 * ⚠️ Why it had to change: the paragraph above has to SHOW the three shapes the previous pattern
 * missed, and writing them down puts three assignments to the name into this file. A guard that
 * cannot describe its own rule without failing is not usable, and deleting the explanation to
 * satisfy the scan would trade the more valuable artifact for the cheaper one.
 *
 * ⚠️ What the departure costs, stated rather than glossed: a COMMENTED-OUT private copy is no
 * longer flagged. That is a real narrowing. It is accepted because a commented-out declaration is
 * not a second live source of truth — no assertion can resolve against it, and `tsc` never sees
 * it — whereas the defect this guard exists for is two live declarations that both compile and
 * both pass.
 *
 * The stripping itself follows `scripts/check-install-smoke.mjs`, which strips block comments
 * before its own specifier scan for the same reason: an unbundled artifact retains its comments,
 * and prose inside them was being read as code.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * RECURSIVE, like the model this file names (`../router/no-change-set-operation.test.ts`).
 *
 * ⚠️ The first version was flat, and that was a silent narrowing rather than a simplification:
 * the plan and the design both say "every `.ts` under `src/idle-budget/`", the directory happens
 * to have no subdirectories today, so a flat scan passed every test while covering less than it
 * claimed. Measured: a copy at `fixtures/leak.ts` was invisible to the flat version.
 *
 * The absence of subdirectories today is exactly what makes the flat version dangerous — nothing
 * would have gone red at the moment someone added one.
 */
function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("exactly one CPU_BUDGET_FRACTION declaration under src/idle-budget", () => {
  it("scans a non-empty set of files, so a passing run means something", () => {
    // ⚠️ THE ANTI-VACUITY CONTROL. Every assertion below is trivially true of an
    // empty file list, which is what a moved directory or a changed extension
    // would produce. Without this, the guard reports success having read nothing
    // — the exact shape this repository's verification playbook exists to catch.
    expect(listTsFiles(IDLE_BUDGET_DIR).length).toBeGreaterThan(0);
  });

  it("finds the declaration in resource-probe.ts, and in no other file here", () => {
    const offenders: string[] = [];
    let foundInSoleFile = false;
    for (const file of listTsFiles(IDLE_BUDGET_DIR)) {
      if (!DECLARATION.test(withoutComments(readFileSync(file, "utf8")))) continue;
      if (file.endsWith(SOLE_DECLARATION_FILE)) foundInSoleFile = true;
      else offenders.push(file);
    }
    // Both halves matter: a guard that only checked for offenders would pass if
    // the constant vanished entirely, and one that only checked the sole file
    // would pass with a private copy sitting beside it.
    expect(foundInSoleFile, `${SOLE_DECLARATION_FILE} declares no CPU_BUDGET_FRACTION`).toBe(true);
    expect(offenders, "a private copy of the budget has reappeared").toStrictEqual([]);
  });

  it("exports the constant, so the sites that assert against it can import it", () => {
    // The declaration existing is not enough — a non-exported const in the
    // production module would leave both call sites unable to reach it, and the
    // obvious repair would be to re-declare a private copy.
    expect(typeof CPU_BUDGET_FRACTION).toBe("number");
  });

  it("holds the value at 0.01, which this change set is a non-goal to alter", () => {
    // T4/E6. The contract names the value a non-goal in as many words; a refactor
    // that quietly moved the bound would be a behaviour change wearing a
    // refactor's clothes, and nothing else in the suite would notice.
    expect(CPU_BUDGET_FRACTION).toBe(0.01);
  });
});
