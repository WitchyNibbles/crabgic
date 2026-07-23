/**
 * The command handlers that have a real backend at this phase's own build
 * time (roadmap/09-cli-and-doctor.md §Interfaces consumed, 05): `status`,
 * `cancel`, `evidence`, `doctor`. Every other command in `./dispatch.ts`
 * returns the typed `NOT_IMPLEMENTED` shape (`./not-implemented.ts`)
 * because its real backend belongs to a phase that hasn't landed yet.
 */
import { EXIT_DOCTOR_FINDINGS, EXIT_OK } from "../exit-codes.js";
import { formatJson, type CommandResult } from "../output/format.js";
import { renderStatusEvent } from "../output/status-renderer.js";
import { buildRepairPlan, runDoctorChecks } from "../doctor/framework.js";
import { buildDefaultDoctorChecks } from "../doctor/run-doctor.js";
import { queryEvidence } from "../evidence/query.js";
import type {
  CancelCommand,
  DoctorCommand,
  EvidenceCommand,
  StatusCommand,
} from "../argv/types.js";
import type { CliDependencies } from "./types.js";
import { notImplementedResult } from "./not-implemented.js";

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

/** `status [run-id] [--watch] [--json]`. Listing every run (no `run-id` supplied) has no backing UDS operation yet (05's router has no `registry.runs.list`) — that shape is `NOT_IMPLEMENTED` until wired; a specific `run-id` is fully wired via `run.status`. */
export async function runStatusCommand(
  cmd: StatusCommand,
  deps: CliDependencies,
  options: { readonly watchSignal?: AbortSignal; readonly emitLine?: (line: string) => void } = {},
): Promise<CommandResult> {
  if (cmd.runId === undefined) {
    return notImplementedResult("status (all runs)", cmd.json);
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
