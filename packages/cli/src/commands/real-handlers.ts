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
import { renderHumanReport, renderStatusLine, type HumanReportSection } from "../output/human.js";
import { CLI_TEXT, pluralize, renderItemListReport, renderResultLine } from "../output/reports.js";
import type {
  PresentationContext,
  PresentationGlyphRole,
  RunLifecycleState,
} from "@crabgic/contracts";
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
import { findUnusedAuthority, renderUnusedAuthority } from "../intake/unused-authority.js";

/** The finding members `doctor`'s human rendering reads — the framework owns the full shape. */
interface DoctorFindingLike {
  readonly id: string;
  readonly passed: boolean;
  readonly severity: string;
  readonly evidence: string;
}

interface RunRecordLike {
  readonly runId: string;
  readonly changeSetId: string;
  readonly runState: string;
  readonly updatedAt: string;
}

/**
 * One run's lifecycle state to its glyph, so a finished or waiting run is
 * findable in a list without reading the words.
 *
 * EXHAUSTIVE OVER `RUN_LIFECYCLE_STATES`, and a test asserts it — the first
 * version of this was written against invented names (`succeeded`,
 * `completed`, a `parked` prefix that belongs to `WorkUnitAttemptStatus`, not
 * to runs). Every one of those was a dead branch, and the states that actually
 * exist fell through the default: `published_local` — a finished run — showed
 * the RUNNING glyph, as did `awaiting_approval`, which is the one state that is
 * waiting on the owner personally. A default-carrying map hid that, so there
 * is no default now.
 *
 * `awaiting_approval` takes `blocked` rather than `question` deliberately:
 * `docs/presentation-policy.md`'s vocabulary defines `blocked` as "halted at a
 * stop condition or approval gate", which is exactly this, while `question` is
 * for a decision being put to the owner inside a report.
 */
export const RUN_STATE_ROLES: Readonly<Record<RunLifecycleState, PresentationGlyphRole>> = {
  draft: "pending",
  awaiting_approval: "blocked",
  ready: "pending",
  running: "running",
  verifying: "running",
  integrating: "running",
  final_verifying: "running",
  published_local: "ok",
  failed: "fail",
  blocked: "blocked",
  cancelled: "info",
};

export function runGlyphRole(runState: string): PresentationGlyphRole {
  // A state the daemon reports that this build does not know is `info`, never
  // an invented verdict: reporting an unknown state as running or failed would
  // be a confident wrong answer about the thing the reader is asking after.
  return RUN_STATE_ROLES[runState as RunLifecycleState] ?? "info";
}

export function renderRunRecord(run: RunRecordLike | undefined, runId: string): string {
  if (run === undefined) {
    return renderResultLine("info", `run "${runId}" is unknown (not started, or never existed)`);
  }
  return renderResultLine(
    runGlyphRole(run.runState),
    `run ${run.runId}: ${run.runState} (changeSet ${run.changeSetId}, updated ${run.updatedAt})`,
  );
}

/** The list form: one compact line per run, without the per-run glyph line's detail tail. */
function runListItem(run: RunRecordLike): string {
  return `${run.runId}: ${run.runState} (updated ${run.updatedAt})`;
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
      ? { exitCode: EXIT_OK, stdout: renderResultLine("ok", `run ${cmd.runId}: resumed`) }
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
    if (runs.length === 0)
      return { exitCode: EXIT_OK, stdout: renderResultLine("info", "no runs") };
    // A registry with many runs was the one place this command could emit an
    // unbounded wall; the list report caps it and says what it held back.
    return {
      exitCode: EXIT_OK,
      stdout: renderItemListReport({
        role: "info",
        lead: `${pluralize(runs.length, "run")}.`,
        title: "Runs",
        items: runs.map(runListItem),
      }),
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
          ? renderResultLine(
              "ok",
              `cancelled "${cmd.targetId}"${result.runState !== undefined ? ` (now ${result.runState})` : ""}`,
            )
          : renderResultLine(
              "fail",
              `could not cancel "${cmd.targetId}" (unknown run, or not cancellable)`,
            ),
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
      stdout: renderResultLine(
        "info",
        `no evidence recorded yet for change set "${cmd.changeSetId}"`,
      ),
    };
  }
  const failed = report.records.filter((r) => r.exitStatus !== 0).length;
  return {
    exitCode: EXIT_OK,
    stdout: renderItemListReport({
      // The lead answers the question the command is actually asked — "did the
      // evidence pass?" — rather than making the reader tally exit codes down
      // a column to find out.
      role: failed > 0 ? "fail" : "ok",
      lead:
        failed > 0
          ? `${String(failed)} of ${String(report.records.length)} evidence records failed.`
          : `${pluralize(report.records.length, "evidence record")}, all passing.`,
      title: "Evidence",
      items: report.records.map(
        (r) => `${r.exitStatus === 0 ? "ok" : "FAILED"} ${r.command} @ ${r.capturedAt}`,
      ),
    }),
  };
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
    // keeps observing the exact same default set unchanged. That set is
    // 10 checks, not the 8 this comment claimed until 2026-08-02 — see
    // `../doctor/run-doctor.ts` for what was added and what pins it.
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

  return {
    exitCode: report.allPassed ? EXIT_OK : EXIT_DOCTOR_FINDINGS,
    stdout: renderDoctorReport(report, repairPlan),
  };
}

/**
 * `doctor`'s human report, under `docs/presentation-policy.md`.
 *
 * WHAT THIS REPLACED. Ten findings, one flat `<glyph> [severity] id: evidence`
 * line each, in registration order, with the passing checks — the majority —
 * interleaved among the failures. That is the "undifferentiated block" the
 * presentation policy names as its motivating defect, and it was the product's
 * largest human report.
 *
 * WHY THE PASSERS COLLAPSE TO A COUNT. A passing check asks nothing of the
 * reader. Eight of them ahead of the two that do is eight chances to lose the
 * thread before reaching the part that matters. The count keeps the report
 * honest about what ran, `--json` remains the lossless channel, and the
 * failures get the space instead.
 *
 * The context is monochrome `text`, matching `status-renderer.ts`'s
 * `MONOCHROME_TEXT`: `doctor` emitted `✓`/`✗` before this rendering existed and
 * its output is asserted byte-wise, so the glyphs are pinned. A caller that has
 * resolved an interactive terminal can pass a context and get the same layout
 * in colour — `renderHumanReport` guarantees the two strip back to each other.
 */
export function renderDoctorReport(
  report: { readonly allPassed: boolean; readonly findings: readonly DoctorFindingLike[] },
  repairPlan: readonly string[] | undefined,
): string {
  const ctx: PresentationContext = CLI_TEXT;
  const failed = report.findings.filter((f) => !f.passed);
  const total = report.findings.length;

  if (failed.length === 0) {
    return `${renderStatusLine("ok", `all ${String(total)} checks passed.`, ctx)}\n`;
  }

  const sections: HumanReportSection[] = [
    {
      title: "Failed",
      bullets: failed.map((f) => `[${f.severity}] ${f.id}: ${f.evidence}`),
    },
  ];
  if (repairPlan !== undefined && repairPlan.length > 0) {
    sections.push({
      title: "Repair plan",
      body: "Non-destructive; not run for you.",
      bullets: repairPlan,
    });
  }
  sections.push({
    title: "Passed",
    body: `${String(total - failed.length)} of ${String(total)} checks passed (--json for the full list).`,
  });

  return renderHumanReport(
    {
      lead: renderStatusLine(
        "fail",
        `${String(failed.length)} of ${String(total)} checks failed.`,
        ctx,
      ),
      sections,
    },
    ctx,
  );
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
    requirements: deps.intake.requirements,
    readIntakeRequest: deps.intake.readIntakeRequest,
    loadPolicy: deps.intake.loadPolicy,
    loadStageCompletions: deps.intake.loadStageCompletions,
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
      message:
        `intake conflict: an intake request with this requestKey already exists with different content (existing content hash ${result.outcome.existingContentHash}); use a fresh requestKey or the amendment flow\n` +
        // The one cause an operator cannot deduce from the line above. Intake's
        // content hash covers the fields the request carries, and that field
        // set changed across the 1.5 -> next upgrade (`performanceBudgetSource`
        // and `performanceBudgets` were removed once intake began deriving
        // them, ledger Gap 21). So an UNCHANGED intake document replayed under
        // its old requestKey across the upgrade hashes differently and lands
        // here — the operator sees "different content" for a file they did not
        // touch. Naming it beats letting them hunt for an edit that never
        // happened.
        "If you just upgraded crabgic, a reused requestKey causes this even for an unchanged request: the request's field set changed across the upgrade, so its content hash did too. See docs/upgrade-guide.md, “Before upgrading”.\n",
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
    //
    // THE REMEDY IS THE POLICY, not `crabgic approve` (corrected 2026-07-30).
    // This message used to lead with `crabgic approve <digest>` — a ceremony
    // that cannot succeed for a standing-policy escalation: approval flips
    // the ChangeSet `ready`, and the daemon's dispatch gate then re-runs the
    // identical containment check with no token input (containment-only by
    // the ledger's ruling), refusing the same envelope again. Every escalate
    // cause — envelope outside the policy, absent policy, unreadable policy —
    // is cured only at the policy file; once it grants the authority,
    // re-running `crabgic run` proceeds with no ceremony at all.
    return {
      exitCode: EXIT_GENERAL_ERROR,
      message:
        `ChangeSet ${sanitizeForTerminal(changeSetId)} needs authority the standing policy does not grant.\n\n` +
        `  ${sanitizeForTerminal(standing.reason)}\n\n` +
        (deps.standingPolicyPath !== undefined
          ? `Grant it by editing the standing policy, which lives at:\n\n` +
            `  ${sanitizeForTerminal(deps.standingPolicyPath)}\n\n`
          : `Grant it by editing the standing policy (run \`crabgic install\` if none exists).\n\n`) +
        `Then run \`crabgic run\` again — an in-policy envelope proceeds with no further ceremony.\n` +
        `(\`crabgic approve ${sanitizeForTerminal(digest)}\` records consent to the plan but cannot ` +
        `grant authority; dispatch re-checks the policy and would refuse the same envelope again.)\n`,
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

  // The critic that runs where nobody reads. Under the standing approval an
  // in-policy envelope is approved with no human looking at it, so a grant wider
  // than the plan needs goes uncaught -- the one thing per-change-set review used
  // to catch for free. Reported, never enforced: the policy allowed this.
  const unused = findUnusedAuthority(
    result.outcome.artifacts.envelope,
    result.outcome.artifacts.workUnits,
  );
  const note = renderUnusedAuthority(unused) ?? "";

  const dispatch = await dispatchReadyChangeSet(changeSetId, deps);
  const authority = ` (covered by the standing approval policy ${sanitizeForTerminal(standing.policyDigest)}; no prompt, no token)`;
  return dispatch.accepted
    ? {
        exitCode: EXIT_OK,
        dispatch,
        message:
          `ChangeSet ${sanitizeForTerminal(changeSetId)} approved${authority} and dispatched as run ${sanitizeForTerminal(dispatch.runId ?? "(unknown)")}\n` +
          note,
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
