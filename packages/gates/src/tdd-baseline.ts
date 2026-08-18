import { spawn } from "node:child_process";
import {
  COMMAND_EVIDENCE_CLASS,
  classifyGrantedCommand,
  type EvidenceRecord,
} from "@crabgic/contracts";
import type { JournalStore } from "@crabgic/journal";
import { captureRedBaseline } from "./tdd-gate.js";

/**
 * `captureTddBaseline` — the PRODUCER half of the red-before-green protocol,
 * and the half that had no production caller until now.
 *
 * ⚠️ WHAT THIS FIXES, MEASURED RATHER THAN ASSERTED. `createTddGate` decides
 * on a red-baseline `EvidenceRecord` it reads out of the journal, and
 * `captureRedBaseline` (`./tdd-gate.ts`) is the only thing in the repository
 * that writes one. Before this module, `captureRedBaseline` had **zero**
 * production call sites — every hit was a doc comment about it or the barrel
 * re-exporting it — and `@crabgic/scheduler` journals no `evidence_pointer`
 * entry of any type. So the red half could not exist in any real run, which is
 * why `implement-tests-first` is underivable for every change set
 * (`packages/cli/src/review/gate-criteria.ts` refuses to presume a missing
 * verdict green) and why owner ruling R7's staged run stopped at stage 6 of 9.
 *
 * OWNER DECISION 2026-08-18 — "harness runs it pre-dispatch". Three options
 * were put to the owner and this is the one chosen: the harness itself runs the
 * declared test command in the attempt's worktree BEFORE the worker is spawned,
 * so the failing exit is HARNESS-OBSERVED rather than self-reported by the
 * party the gate is judging. The two rejected alternatives were the worker
 * running it and the harness verifying journal ordering (cheaper, but the
 * subject attests its own compliance), and reconstructing the run from the
 * engine's `toolUse` stream (free, but silently blind to any command phrasing
 * the matcher does not recognise).
 *
 * ⚠️ THE COMMAND IS NOT INVENTED HERE, AND THAT IS THE SECURITY PROPERTY. It
 * comes from the run's approved `AuthorizationEnvelope.commands`, filtered to
 * members `classifyGrantedCommand` places in the `acceptance` class
 * (`@crabgic/contracts`' `COMMAND_EVIDENCE_CLASS`). An envelope granting no
 * such command authorizes no test run, so this returns
 * `noAcceptanceCommand` and journals nothing — the gate then fails closed at
 * `verifying`, which is the correct direction. Reaching for a conventional
 * `npm test` instead would be the harness executing a command the owner never
 * approved, which is the "expanded authority" refusal the operating protocol
 * names.
 *
 * NOT A GATE, AND SO NOT SUBJECT TO THE DAEMON'S NO-STACK-COMMAND ADMISSION
 * TEST. `packages/cli/src/daemon/compose-gate-registry.ts` admits a handler
 * into the daemon process only if it executes no stack command. This is not a
 * handler and it fires at no stage: it is pre-dispatch evidence PRODUCTION,
 * running once per attempt in the attempt's own worktree, on the same authority
 * the worker about to be spawned already holds.
 */

/** How long the baseline command may run before it is killed and treated as having produced no baseline. */
export const TDD_BASELINE_TIMEOUT_MS = 15 * 60 * 1000;

export interface TddBaselineInput {
  readonly journal: JournalStore;
  readonly changeSetId: string;
  readonly workUnitId: string;
  /** The work unit's own declared requirement ids — the gate is requirement-scoped, so a baseline is captured per id. */
  readonly requirementIds: readonly string[];
  /** The run's ONE frozen base object id — what "red at base" is red against. */
  readonly baseObjectId: string;
  /** The attempt's isolated worktree, already provisioned. The command runs here and nowhere else. */
  readonly worktreePath: string;
  /** `AuthorizationEnvelope.commands` for this run, verbatim. Never a default, never a superset. */
  readonly grantedCommands: readonly string[];
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

/**
 * Why this attempt has, or has not, a red baseline. Every non-`captured`
 * member is a REFUSAL to fabricate one, and each is distinct because each has a
 * different repair: grant a test command, write a failing test, declare a
 * requirement.
 */
export type TddBaselineOutcome =
  | {
      readonly kind: "captured";
      readonly command: string;
      readonly exitStatus: number;
      readonly records: readonly EvidenceRecord[];
    }
  /** The command ran and PASSED at base. A suite that is already green proves nothing about a new test's ability to catch a regression. */
  | { readonly kind: "notRed"; readonly command: string; readonly exitStatus: number }
  /**
   * The command never ran to completion — it could not be started (a missing or
   * unprovisioned worktree), or it was killed on the timeout.
   *
   * ⚠️ DISTINCT FROM `notRed`, AND THE DISTINCTION IS LOAD-BEARING. A process
   * that fails to spawn and one that is SIGKILLed both leave a non-zero status,
   * so folding either into the red path would let a mis-provisioned worktree or
   * a hung suite mint the strongest evidence this system has — a red baseline
   * for a test nobody wrote.
   */
  | { readonly kind: "didNotRun"; readonly command: string; readonly reason: string }
  /** The envelope grants no `acceptance`-class command, so nothing was run. */
  | { readonly kind: "noAcceptanceCommand" }
  /** The work unit declares no requirements, so there is nothing to scope a record to. */
  | { readonly kind: "noRequirements" };

/**
 * The first granted command that establishes acceptance, in
 * `grantedCommands` order.
 *
 * The envelope's own string is returned rather than the matched PREFIX: the
 * compiled profile emits a `Bash(<prefix>:*)` rule, so `npm run test:unit` is
 * genuinely within the `npm run test` grant and substituting the bare prefix
 * would run a DIFFERENT command from the one the owner approved. A string
 * matching no prefix returns nothing — `classifyGrantedCommand` answers
 * `undefined` for it and the permission profile discards it silently, so
 * treating it as runnable here would turn a policy author's typo into an
 * executed command.
 */
export function selectAcceptanceCommand(grantedCommands: readonly string[]): string | undefined {
  for (const command of grantedCommands) {
    const prefix = classifyGrantedCommand(command);
    if (prefix === undefined) continue;
    if (COMMAND_EVIDENCE_CLASS[prefix] !== "acceptance") continue;
    return command;
  }
  return undefined;
}

/**
 * Runs `command` in `cwd` and resolves its exit status.
 *
 * `stdio: "ignore"` deliberately: this function's product is an exit status,
 * and a test suite's stdout is the single most likely place for a secret to
 * appear in a form nothing downstream would redact. A timeout kills the tree
 * and reports a non-zero status — but the caller distinguishes that case, since
 * a timed-out run is not evidence that a test failed.
 */
type CommandRun =
  | { readonly ran: true; readonly exitStatus: number }
  | { readonly ran: false; readonly reason: string };

async function runToExitStatus(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<CommandRun> {
  const child = spawn(command, { cwd, shell: true, stdio: "ignore" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  try {
    const run = await new Promise<CommandRun>((resolve) => {
      // A signal-terminated child reports `code === null`. It did not run to
      // completion, so it never reports an exit status — reporting one would be
      // this function inventing the very number its caller decides on.
      child.on("exit", (code) =>
        resolve(
          code === null
            ? { ran: false, reason: `killed by signal after ${String(timeoutMs)}ms` }
            : { ran: true, exitStatus: code },
        ),
      );
      // ⚠️ A spawn failure is NOT a failing test. `cwd` may not exist, or the
      // shell may be unavailable; either way nothing was executed, so there is
      // no verdict to report.
      child.on("error", (err) =>
        resolve({ ran: false, reason: `could not start: ${err.message}` }),
      );
    });
    if (timedOut) return { ran: false, reason: `timed out after ${String(timeoutMs)}ms` };
    return run;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the granted acceptance command at base and journals one red-baseline
 * `EvidenceRecord` per declared requirement, or explains why it did not.
 *
 * ⚠️ ONE RECORD PER REQUIREMENT, not one shared record. `hasRedBaseline` scopes
 * its search by `requirementId`, so a single record would let one unit's red
 * run silently satisfy the gate for a requirement whose tests never ran.
 *
 * A run that did not COMPLETE — failed to spawn, or was killed on the timeout —
 * is `didNotRun`, never `captured`. Both leave a non-zero status, so treating
 * exit status alone as the signal would let a mis-provisioned worktree or a
 * hung suite mint the strongest evidence this system has: a red baseline for a
 * test nobody wrote.
 */
export async function captureTddBaseline(input: TddBaselineInput): Promise<TddBaselineOutcome> {
  if (input.requirementIds.length === 0) return { kind: "noRequirements" };

  const command = selectAcceptanceCommand(input.grantedCommands);
  if (command === undefined) return { kind: "noAcceptanceCommand" };

  const run = await runToExitStatus(
    command,
    input.worktreePath,
    input.timeoutMs ?? TDD_BASELINE_TIMEOUT_MS,
  );
  if (!run.ran) return { kind: "didNotRun", command, reason: run.reason };
  const exitStatus = run.exitStatus;
  if (exitStatus === 0) return { kind: "notRed", command, exitStatus };

  const records: EvidenceRecord[] = [];
  for (const requirementId of input.requirementIds) {
    records.push(
      await captureRedBaseline(input.journal, {
        changeSetId: input.changeSetId,
        requirementId,
        workUnitId: input.workUnitId,
        baseObjectId: input.baseObjectId,
        command,
        exitStatus,
        toolchainFingerprint: `node@${process.versions.node}`,
        ...(input.now !== undefined ? { now: input.now } : {}),
      }),
    );
  }
  return { kind: "captured", command, exitStatus, records };
}
