/**
 * `createFakeSandboxRunner` — the in-process stand-in for
 * `@anthropic-ai/sandbox-runtime` (see `./types.ts`'s doc comment for the
 * deferred-dependency deviation). Exercises roadmap/12's own named
 * security test: "stage-5 sandboxed test attempting network egress (must
 * be denied, `allowedDomains: []`) and attempting to read `~/.ssh` (must
 * be denied, `denyRead`)." Never spawns a process, never touches the real
 * filesystem or network — purely evaluates each declared operation
 * against the policy.
 *
 * ADVERSARIAL-REVIEW FIX (MEDIUM, confirmed fail-open): `passed` used to
 * be hardcoded `true` regardless of `deniedOperations` — a candidate
 * declaring network egress or a `~/.ssh` read reached stage 6 (`pending`)
 * with the denial only "recorded," never gating anything, and a candidate
 * with an empty/absent self-test plan sailed through identically to one
 * that was actually contained. This runner is now a REAL (if in-process)
 * policy evaluator: `passed` is `false` whenever the declared plan
 * includes ANY denied operation — `../stages/sandbox-stage.ts` propagates
 * that verdict straight through (`passed: sandboxResult.passed`), so
 * `../pipeline.ts` now genuinely rejects at stage 5 instead of recording a
 * denial and proceeding anyway.
 */
import type {
  DeclaredOperation,
  SandboxPolicy,
  SandboxRunner,
  SandboxTestResult,
} from "./types.js";

function isDenied(op: DeclaredOperation, policy: SandboxPolicy): boolean {
  if (op.type === "network") {
    return !policy.allowedDomains.some(
      (domain) => op.target === domain || op.target.endsWith(`.${domain}`),
    );
  }
  // read/write: denied if the target is under (or exactly) a deny-listed path.
  return policy.denyReadPaths.some(
    (denied) => op.target === denied || op.target.startsWith(`${denied}/`),
  );
}

export function createFakeSandboxRunner(): SandboxRunner {
  return {
    run(operations: readonly DeclaredOperation[], policy: SandboxPolicy): SandboxTestResult {
      const deniedOperations = operations
        .filter((op) => isDenied(op, policy))
        .map((op) => `${op.type}:${op.target}`);

      return {
        passed: deniedOperations.length === 0, // a real policy verdict: any denied operation fails the self-test
        deniedOperations,
        detail:
          deniedOperations.length === 0
            ? "no declared operation required denial under this policy"
            : `${String(deniedOperations.length)} declared operation(s) denied: ${deniedOperations.join(", ")}`,
      };
    },
  };
}
