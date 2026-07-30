/**
 * The command handlers that have a real backend at this phase's own build
 * time (roadmap/09-cli-and-doctor.md §Interfaces consumed, 05): `status`,
 * `cancel`, `evidence`, `doctor`. Every other command in `./dispatch.ts`
 * returns the typed `NOT_IMPLEMENTED` shape (`./not-implemented.ts`)
 * because its real backend belongs to a phase that hasn't landed yet.
 */
import { EXIT_DOCTOR_FINDINGS, EXIT_OK, EXIT_GENERAL_ERROR } from "../exit-codes.js";
import { toErrorMessage } from "../errors.js";
import { formatJson, type CommandResult } from "../output/format.js";
import { renderStatusEvent } from "../output/status-renderer.js";
import { renderRunProgress, summarizeRunProgress } from "../output/run-progress.js";
import { buildRepairPlan, runDoctorChecks } from "../doctor/framework.js";
import { buildDefaultDoctorChecks } from "../doctor/run-doctor.js";
import { queryEvidence } from "../evidence/query.js";
import type {
  CancelCommand,
  DoctorCommand,
  EvidenceCommand,
  ResumeCommand,
  RunCommand,
  StatusCommand,
} from "../argv/types.js";
import type { CliDependencies } from "./types.js";
import { notImplementedResult } from "./not-implemented.js";
import { runIntakeCommand, type RunIntakeCommandResult } from "../intake/run-intake-command.js";
import { sanitizeForTerminal } from "../output/sanitize.js";

interface RunRecordLike {
  readonly runId: string;
  readonly changeSetId: string;
  readonly runState: string;
  readonly updatedAt: string;
}

function renderRunRecord(run: RunRecordLike | undefined, runId: string): string {
  if (run === undefined) {
    return `run "${runId}" is unknown (not yet started, or never existed)\n`;
  }
  return `run ${run.runId}: ${run.runState} (changeSet ${run.changeSetId}, updated ${run.updatedAt})\n`;
}

/**
 * `resume <run-id>` — asks the daemon to (re-)drive an existing run's DAG.
 *
 * A thin wrapper over `run.dispatch` on purpose. The daemon owns the
 * driver, its dispatcher is idempotent per run (a resume of a run already
 * in flight is refused, not duplicated), and `driveRun` recomputes
 * readiness from each unit's current attempt status — so units that already
 * succeeded are simply not ready again, and the resume picks up exactly
 * where the run stopped. There is nothing for the CLI to reconstruct.
 */
export async function runResumeCommand(
  cmd: ResumeCommand,
  deps: CliDependencies,
): Promise<CommandResult> {
  const client = await deps.connectClient();
  try {
    // `run.resume`, not `run.dispatch` (2026-07-28, ledger Gap 18). The two
    // were one operation keyed on a runId, which is why the case that
    // mattered — starting an approved change set — had no reachable form:
    // every caller needed an id nothing in the system ever minted. Dispatch
    // now takes a ChangeSet and RETURNS the id; resume is this, re-driving a
    // run that already exists.
    const result = await client.request<{ accepted: boolean; reason?: string }>("run.resume", {
      runId: cmd.runId,
    });

    if (cmd.json) {
      return {
        exitCode: result.accepted ? EXIT_OK : EXIT_GENERAL_ERROR,
        stdout: formatJson(result),
      };
    }
    return result.accepted
      ? { exitCode: EXIT_OK, stdout: `run ${cmd.runId}: resumed\n` }
      : {
          exitCode: EXIT_GENERAL_ERROR,
          stderr: `run ${cmd.runId} was not resumed: ${result.reason ?? "refused"}\n`,
        };
  } finally {
    client.close();
  }
}

/**
 * The no-`run-id` shape of `status`: every run the daemon knows about.
 * `--watch` is deliberately not honored here — 05 emits per-run events, not
 * a registry-wide stream, so "watch everything" would be a poll loop
 * pretending to be a subscription. Watching a specific run still works.
 */
async function runStatusAllCommand(
  cmd: StatusCommand,
  deps: CliDependencies,
): Promise<CommandResult> {
  const client = await deps.connectClient();
  try {
    const { runs } = await client.request<{ runs: readonly RunRecordLike[] }>(
      "registry.runs.list",
      {},
    );

    if (cmd.json) return { exitCode: EXIT_OK, stdout: formatJson({ runs }) };
    if (runs.length === 0) return { exitCode: EXIT_OK, stdout: "no runs\n" };
    return {
      exitCode: EXIT_OK,
      stdout: runs.map((run) => renderRunRecord(run, run.runId)).join(""),
    };
  } finally {
    client.close();
  }
}

/**
 * `status [run-id] [--watch] [--json]`. Both shapes are wired: a specific
 * `run-id` goes through `run.status`, and the no-argument "every run" form
 * through `registry.runs.list` (added to 05's router 2026-07-25 — before
 * that it had no backing UDS operation at all, so this branch could only
 * return `NOT_IMPLEMENTED`, leaving an operator who had not written down a
 * run id with no way to find one).
 */
export async function runStatusCommand(
  cmd: StatusCommand,
  deps: CliDependencies,
  options: { readonly watchSignal?: AbortSignal; readonly emitLine?: (line: string) => void } = {},
): Promise<CommandResult> {
  if (cmd.runId === undefined) {
    return runStatusAllCommand(cmd, deps);
  }

  const client = await deps.connectClient();
  try {
    const result = await client.request<{ run?: RunRecordLike }>("run.status", {
      runId: cmd.runId,
    });

    if (!cmd.watch) {
      // Progress comes from the JOURNAL, not from the supervisor's reply: the
      // run record carries a lifecycle state ("running"), which answers "is it
      // going?" and not "how far has it got?". For a run spanning several work
      // units those are different questions, and only the second one tells an
      // operator whether to keep waiting.
      // `--json` is NOT widened, deliberately. This suite's own contract note
      // says `status`/`cancel` JSON output "IS literally 05's own published
      // `RunStatusResultSchema` (the raw UDS result, never re-shaped)", and that
      // schema is `.strict()`. Adding a CLI-side key here is a cross-phase
      // interface change the ledger governs, not something a rendering
      // improvement gets to smuggle in — so progress is human-rendered only, and
      // a JSON consumer that needs it should get a ruling first.
      if (cmd.json) {
        return { exitCode: EXIT_OK, stdout: formatJson(result) };
      }
      const progress = await summarizeRunProgress(deps.journal, cmd.runId);
      return {
        exitCode: EXIT_OK,
        stdout: renderRunRecord(result.run, cmd.runId) + (renderRunProgress(progress) ?? ""),
      };
    }

    const emit = options.emitLine ?? (() => undefined);
    emit(renderRunRecord(result.run, cmd.runId));

    await new Promise<void>((resolve) => {
      const unsubscribe = client.onEvent((event, payload) => {
        emit(renderStatusEvent({ event, payload }));
      });
      const signal = options.watchSignal;
      if (signal === undefined) return; // real interactive usage: streams until the process itself exits (e.g. Ctrl+C).
      if (signal.aborted) {
        unsubscribe();
        resolve();
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          unsubscribe();
          resolve();
        },
        { once: true },
      );
    });

    return { exitCode: EXIT_OK, stdout: cmd.json ? formatJson(result) : "" };
  } finally {
    await client.close();
  }
}

/** `cancel <run-id|task-id>` — wired to `run.cancel` (work-unit/task-level cancellation is 13's own semantics; this phase wires only the run-scoped op 05 already exposes). */
export async function runCancelCommand(
  cmd: CancelCommand,
  deps: CliDependencies,
): Promise<CommandResult> {
  const client = await deps.connectClient();
  try {
    const result = await client.request<{ accepted: boolean; runState?: string }>("run.cancel", {
      runId: cmd.targetId,
    });
    return {
      exitCode: EXIT_OK,
      stdout: cmd.json
        ? formatJson(result)
        : result.accepted
          ? `cancelled "${cmd.targetId}"${result.runState !== undefined ? ` (now ${result.runState})` : ""}\n`
          : `could not cancel "${cmd.targetId}" (unknown run, or already in a non-cancellable state)\n`,
    };
  } finally {
    await client.close();
  }
}

/** `evidence <change-set-id>` — a real query over 04's journal from this phase's own build onward (roadmap/09 §In scope); degrades gracefully to an empty-but-valid report. */
export async function runEvidenceCommand(
  cmd: EvidenceCommand,
  deps: CliDependencies,
): Promise<CommandResult> {
  const report = await queryEvidence({ journal: deps.journal, changeSetId: cmd.changeSetId });
  if (cmd.json) {
    return { exitCode: EXIT_OK, stdout: formatJson(report) };
  }
  if (report.records.length === 0) {
    return {
      exitCode: EXIT_OK,
      stdout: `no evidence recorded yet for change set "${cmd.changeSetId}"\n`,
    };
  }
  const lines = report.records.map(
    (r) => `- ${r.command} (exit ${String(r.exitStatus)}) @ ${r.objectId} — ${r.capturedAt}`,
  );
  return { exitCode: EXIT_OK, stdout: `${lines.join("\n")}\n` };
}

/** `doctor [--repair-plan] [--json]`. */
export async function runDoctorCommand(
  cmd: DoctorCommand,
  deps: CliDependencies,
): Promise<CommandResult> {
  const checks = buildDefaultDoctorChecks({
    projectHash: deps.projectHash,
    journal: deps.journal,
    ...(deps.resolveAuthState !== undefined ? { resolveAuthState: deps.resolveAuthState } : {}),
    // roadmap/10-plugin-and-installer.md's own 3 doctor checks
    // (checksum-drift, plugin-trust-pin, CapabilityManifest-digest-
    // freshness) register into the default set ONLY when `deps.installer`
    // is present — see `../doctor/run-doctor.ts`'s own optionality
    // comment; every pre-existing roadmap/09 test (no `deps.installer`)
    // keeps observing the exact same 8-check default set unchanged.
    // Gap 18: the standing policy's own check, wired whenever the caller knows
    // where the policy lives.
    ...(deps.standingPolicyPath !== undefined
      ? { standingPolicyPath: deps.standingPolicyPath }
      : {}),
    ...(deps.installer !== undefined
      ? {
          installer: {
            targetDir: deps.installer.targetDir,
            pluginSourceDir: deps.installer.pluginSourceDir,
          },
        }
      : {}),
  });
  const report = await runDoctorChecks(checks);
  const repairPlan = cmd.repairPlan ? buildRepairPlan(report) : undefined;

  if (cmd.json) {
    return {
      exitCode: report.allPassed ? EXIT_OK : EXIT_DOCTOR_FINDINGS,
      stdout: formatJson({ ...report, ...(repairPlan !== undefined ? { repairPlan } : {}) }),
    };
  }

  const lines = report.findings.map(
    (f) => `${f.passed ? "✓" : "✗"} [${f.severity}] ${f.id}: ${f.evidence}`,
  );
  if (repairPlan !== undefined && repairPlan.length > 0) {
    lines.push("", "Repair plan (non-destructive, not auto-executed):", ...repairPlan);
  }
  return {
    exitCode: report.allPassed ? EXIT_OK : EXIT_DOCTOR_FINDINGS,
    stdout: `${lines.join("\n")}\n`,
  };
}

/**
 * `run [--json]` — roadmap/11-intake-contract-approval.md's pre-dispatch
 * intake -> contract -> approval sequence. Wired ONLY when
 * `deps.intake` is supplied (`../commands/types.ts`'s own doc comment
 * explains why this mirrors `installer`'s identical optionality); real
 * interactive I/O defaults to `process.stdin`/`process.stdout`, matching
 * `../gateway-mcp/stdio-server.ts`'s own default-stream convention.
 */
export async function runRunCommand(
  cmd: RunCommand,
  deps: CliDependencies,
): Promise<CommandResult> {
  if (deps.intake === undefined) {
    return notImplementedResult(cmd.command, cmd.json);
  }

  const result = await runIntakeCommand({
    journal: deps.intake.journal,
    changeSets: deps.intake.changeSets,
    workUnits: deps.intake.workUnits,
    envelopes: deps.intake.envelopes,
    intentContracts: deps.intake.intentContracts,
    readIntakeRequest: deps.intake.readIntakeRequest,
    loadPolicy: deps.intake.loadPolicy,
  });

  // The outcome is decided ONCE, then rendered. The previous shape returned
  // `--json` early, above the branches that decide the exit code, so every
  // refusal -- an escaping envelope, an unowned requirement, a requestKey
  // conflict -- reported exit 0 in JSON mode. A caller cannot tell an approval
  // from a refusal by status, which is the one thing an exit code is for.
  const decided = await decideRunOutcome(result, deps);
  return cmd.json
    ? {
        exitCode: decided.exitCode,
        stdout: formatJson({
          ...result,
          ...(decided.dispatch !== undefined ? { dispatch: decided.dispatch } : {}),
        }),
      }
    : decided.exitCode === EXIT_OK
      ? { exitCode: decided.exitCode, stdout: decided.message }
      : { exitCode: decided.exitCode, stderr: decided.message };
}

interface DecidedRunOutcome {
  readonly exitCode: number;
  /** Human-readable rendering, written to stdout on success and stderr on refusal. */
  readonly message: string;
  readonly dispatch?: DispatchAttempt;
}

/** Turns an intake result into an exit code, a message, and (only when the change set is genuinely ready) a dispatch attempt. */
async function decideRunOutcome(
  result: RunIntakeCommandResult,
  deps: CliDependencies,
): Promise<DecidedRunOutcome> {
  if (result.outcome.status === "conflict") {
    return {
      exitCode: EXIT_GENERAL_ERROR,
      message: `intake conflict: an intake request with this requestKey already exists with different content (existing content hash ${result.outcome.existingContentHash}); use a fresh requestKey or the amendment flow\n`,
    };
  }

  const changeSetId = result.outcome.artifacts.changeSet.id;
  const digest = result.outcome.artifacts.envelope.canonicalHash;
  const standing = result.standing;

  if (standing === undefined) {
    // Unreachable: `runIntakeCommand` always returns a decision for a
    // non-conflict outcome. Refusing beats assuming an approval.
    return {
      exitCode: EXIT_GENERAL_ERROR,
      message: `no approval decision was reached for ChangeSet ${sanitizeForTerminal(changeSetId)}\n`,
    };
  }

  if (standing.status === "not_ready") {
    return {
      exitCode: EXIT_GENERAL_ERROR,
      message:
        `this change set cannot be approved by any route yet: ${sanitizeForTerminal(standing.reason)}\n` +
        "Fix the plan so every requirement has an owning work unit, then run intake again.\n",
    };
  }

  if (standing.status === "escalate") {
    // The refusal names every escaping dimension, and this is where the
    // operator reads it. It used to be computed and then dropped on the floor:
    // the human path rendered a bare digest prompt instead, and `--json`
    // reported exit 0.
    return {
      exitCode: EXIT_GENERAL_ERROR,
      message:
        `ChangeSet ${sanitizeForTerminal(changeSetId)} needs approval it does not already have.\n\n` +
        `  ${sanitizeForTerminal(standing.reason)}\n\n` +
        `Approve it yourself in a terminal you opened:\n\n` +
        `  crabgic approve ${sanitizeForTerminal(digest)}\n\n` +
        (deps.standingPolicyPath !== undefined
          ? `Or widen the standing policy, which lives at:\n\n  ${sanitizeForTerminal(deps.standingPolicyPath)}\n`
          : ""),
    };
  }

  // Approved. Only a `ready` ChangeSet is dispatchable: a replay of one already
  // running -- or finished -- is authorized but must not start a second run for
  // the same change set.
  if (standing.changeSet.state !== "ready") {
    return {
      exitCode: EXIT_OK,
      message: `ChangeSet ${sanitizeForTerminal(changeSetId)} is already ${standing.changeSet.state}; nothing to start\n`,
    };
  }

  const dispatch = await dispatchReadyChangeSet(changeSetId, deps);
  const authority = ` (covered by the standing approval policy ${sanitizeForTerminal(standing.policyDigest)}; no prompt, no token)`;
  return dispatch.accepted
    ? {
        exitCode: EXIT_OK,
        dispatch,
        message: `ChangeSet ${sanitizeForTerminal(changeSetId)} approved${authority} and dispatched as run ${sanitizeForTerminal(dispatch.runId ?? "(unknown)")}\n`,
      }
    : {
        // The approval is durable and the ChangeSet stays `ready`; only the
        // start failed, so the remedy is retrying the start.
        exitCode: EXIT_GENERAL_ERROR,
        dispatch,
        message: `ChangeSet ${sanitizeForTerminal(changeSetId)} is approved and ready, but dispatch was refused: ${sanitizeForTerminal(dispatch.reason ?? "no reason given")}\n`,
      };
}

export interface DispatchAttempt {
  readonly accepted: boolean;
  readonly runId?: string;
  readonly reason?: string;
}

/**
 * Asks the supervisor to start an approved ChangeSet — the `run.dispatch`
 * operation that, until now, no shipped surface ever sent. The daemon mints
 * the run id (nothing else can) and re-runs the containment check against the
 * policy IT can see before spawning a worker.
 *
 * A supervisor that cannot be reached is reported, never thrown past: the
 * approval already happened and the ChangeSet is durably `ready`, so this is a
 * retryable start failure rather than a lost approval.
 */
export async function dispatchReadyChangeSet(
  changeSetId: string,
  deps: CliDependencies,
): Promise<DispatchAttempt> {
  let client: Awaited<ReturnType<CliDependencies["connectClient"]>>;
  try {
    client = await deps.connectClient();
  } catch (err) {
    return { accepted: false, reason: toErrorMessage(err) };
  }
  try {
    return await client.request<DispatchAttempt>("run.dispatch", { changeSetId });
  } catch (err) {
    return { accepted: false, reason: toErrorMessage(err) };
  } finally {
    await client.close();
  }
}
