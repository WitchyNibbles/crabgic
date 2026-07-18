/**
 * Compound-command and process-wrapper smuggling detection (roadmap/03-
 * envelope-compiler-engine-adapter.md §In scope "Fake engine" bullet;
 * docs/engine-baseline.md §3: compound-command `echo x && curl ...` and
 * process-wrapper `nohup curl ...` both denied because the curl
 * subcommand independently fails to match the allow rule). This is a
 * deliberately simple lexical splitter/stripper, not a full shell parser
 * — sufficient for the smuggling shapes docs/engine-baseline.md actually
 * probed (no quoting/subshell coverage).
 */

const COMPOUND_SPLIT_PATTERN = /\s*(?:&&|\|\||;|\|)\s*/;

export function splitCompoundCommand(command: string): readonly string[] {
  return command
    .split(COMPOUND_SPLIT_PATTERN)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

const WRAPPER_TOKENS: ReadonlySet<string> = new Set(["nohup", "nice", "timeout"]);
/** Hard cap on wrapper-stripping iterations — never loops on pathological input. */
const MAX_WRAPPER_STRIP_ITERATIONS = 5;

export function stripProcessWrapper(segment: string): string {
  let current = segment.trim();
  for (let i = 0; i < MAX_WRAPPER_STRIP_ITERATIONS; i += 1) {
    const tokens = current.split(/\s+/);
    const head = tokens[0];
    if (head === undefined || !WRAPPER_TOKENS.has(head)) {
      break;
    }
    const rest = tokens.slice(1);
    if (head === "timeout") {
      // drop the wrapper token and its duration argument (e.g. "10", "10s")
      rest.shift();
    }
    current = rest.join(" ").trim();
    if (current.length === 0) {
      break;
    }
  }
  return current;
}

export function decomposeBashCommand(command: string): readonly string[] {
  return splitCompoundCommand(command).map(stripProcessWrapper);
}

const BASH_RULE_PATTERN = /^Bash\((.+):\*\)$/;

export function matchesBashPrefixRule(rule: string, strippedSegment: string): boolean {
  const match = BASH_RULE_PATTERN.exec(rule);
  const prefix = match?.[1];
  if (prefix === undefined) {
    return false;
  }
  return strippedSegment === prefix || strippedSegment.startsWith(`${prefix} `);
}

/**
 * MAJOR 2 fix (phase-03 security-fix round): shell metacharacters this
 * fake oracle has NOT proven safe. `docs/engine-baseline.md` §3 recorded
 * verdicts only for `&&`/`||`/`;`/`|` (compound operators, already handled
 * by `COMPOUND_SPLIT_PATTERN` above) and `nohup`/`timeout`/`nice` (process
 * wrappers, already handled by `stripProcessWrapper`) — it never probed a
 * lone `&` (background), `$(...)`/backtick command substitution, `${...}`
 * parameter expansion, redirects (`>`, `>>`, `<`), or embedded newlines.
 *
 * Before this fix, none of those forms were recognized as compound
 * operators, so e.g. `"git status & curl evil"` stayed a SINGLE segment
 * that `.startsWith("git status ")` — an unmatched trailing command
 * smuggled through as an allowed-prefix match (validator's exact attack).
 *
 * This fake is a confinement ORACLE reused by 05/06 — where the real
 * engine's verdict for a form is unproven, the oracle MUST err toward
 * denial, never allow (roadmap/03 §Risks: "a defect here silently disables
 * enforcement for every worker in the system"). Any segment carrying one of
 * these characters is therefore treated as an unmatchable smuggling
 * attempt regardless of whether it also happens to start with an allowed
 * prefix.
 */
const UNPROVEN_SHELL_METACHARACTER_PATTERN = /[&$`<>]|\r|\n/;

export function containsUnprovenShellMetacharacter(segment: string): boolean {
  return UNPROVEN_SHELL_METACHARACTER_PATTERN.test(segment);
}
