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
import { runIntakeCommand } from "../intake/run-intake-command.js";

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
      return {
        exitCode: EXIT_OK,
        stdout: cmd.json ? formatJson(result) : renderRunRecord(result.run, cmd.runId),
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
    minter: deps.intake.minter,
    secretKey: deps.intake.secretKey,
    io: deps.intake.io ?? { input: process.stdin, output: process.stdout },
    readIntakeRequest: deps.intake.readIntakeRequest,
    ...(deps.intake.loadPolicy !== undefined ? { loadPolicy: deps.intake.loadPolicy } : {}),
  });

  if (result.outcome.status === "conflict") {
    const conflict = {
      exitCode: EXIT_GENERAL_ERROR,
      stderr: `intake conflict: an intake request with this requestKey already exists with different content (existing content hash ${result.outcome.existingContentHash}); use a fresh requestKey or the amendment flow\n`,
    };
    return cmd.json ? { ...conflict, stdout: formatJson(result) } : conflict;
  }
  const changeSetId = result.outcome.artifacts.changeSet.id;
  const digest = result.outcome.artifacts.envelope.canonicalHash;

  // Approved by either route -> DISPATCH. `run` means run: an approved change
  // set that sits in `ready` waiting for a second command is the shape ledger
  // Gap 18's product direction exists to remove ("the user types no Crabgic
  // command"). The daemon re-checks containment itself before spawning
  // anything, so this is a request to start work, never a grant of authority.
  const approved =
    result.standing?.status === "approved" ||
    (result.standing === undefined &&
      result.declined !== true &&
      result.approval?.approved === true);

  if (approved) {
    const dispatch = await dispatchReadyChangeSet(changeSetId, deps);
    if (cmd.json) {
      return {
        exitCode: dispatch.accepted ? EXIT_OK : EXIT_GENERAL_ERROR,
        stdout: formatJson({ ...result, dispatch }),
      };
    }
    const authority =
      result.standing?.status === "approved"
        ? ` (covered by the standing approval policy ${result.standing.policyDigest}; no prompt, no token)`
        : "";
    return dispatch.accepted
      ? {
          exitCode: EXIT_OK,
          stdout: `ChangeSet ${changeSetId} approved${authority} and dispatched as run ${dispatch.runId}\n`,
        }
      : {
          // The ChangeSet IS approved and stays `ready`; only the start
          // failed. Say exactly that, so the operator retries the dispatch
          // rather than re-authoring an intake request.
          exitCode: EXIT_GENERAL_ERROR,
          stderr: `ChangeSet ${changeSetId} is approved and ready, but dispatch was refused: ${dispatch.reason}\n`,
        };
  }

  if (cmd.json) {
    // `result` carries no token by construction (`RunIntakeCommandResult`'s
    // own doc comment): rendering one here was the model-as-courier exposure
    // ledger Gap 18's audit recorded, and the shape below is asserted
    // token-free by `./intake-dispatch.test.ts`.
    return { exitCode: EXIT_OK, stdout: formatJson(result) };
  }

  if (result.standing?.status === "not_ready") {
    return {
      exitCode: EXIT_GENERAL_ERROR,
      stderr:
        `this change set cannot be approved by any route yet: ${result.standing.reason}\n` +
        "Fix the plan so every requirement has an owning work unit, then run intake again.\n",
    };
  }
  if (result.declined === true) {
    return {
      exitCode: EXIT_OK,
      stdout:
        "approval declined — no token minted; ChangeSet remains awaiting_approval\n" +
        `(a human can approve it later with \`crabgic approve ${digest}\`)\n`,
    };
  }
  if (result.approval !== undefined && !result.approval.approved) {
    return {
      exitCode: EXIT_GENERAL_ERROR,
      stderr: `approval confirmed at the prompt but verification failed: ${result.approval.reason}\n`,
    };
  }
  return {
    exitCode: EXIT_OK,
    stdout: `ChangeSet ${changeSetId} approved — now ready\n`,
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
