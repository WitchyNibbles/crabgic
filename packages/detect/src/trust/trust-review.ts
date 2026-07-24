/**
 * `trust review` backend — roadmap/12 §Interfaces produced: "CLI `trust
 * review|approve|revoke` — backend for the command 09 declares
 * (`NOT_IMPLEMENTED` stub until this phase lands)." Lists every capability-
 * store entry, most-recently-audited first, so a human reviewer can see
 * what is `pending` (awaiting `trust approve`), already `approved`, or
 * `rejected`.
 */
import {
  EXIT_OK,
  formatJson,
  type CommandResult,
  type TrustReviewCommand,
} from "engineering-orchestrator";
import type { TrustCommandDependencies } from "./dependencies.js";

function renderEntryLine(entry: {
  readonly report: {
    readonly candidateName: string;
    readonly kind: string;
    readonly digest: string;
    readonly decision: string;
  };
}): string {
  const { candidateName, kind, digest, decision } = entry.report;
  return `[${decision}] ${kind} "${candidateName}" — ${digest}`;
}

export function runTrustReviewCommand(
  cmd: TrustReviewCommand,
  deps: TrustCommandDependencies,
): CommandResult {
  const entries = [...deps.store.list()].sort((a, b) =>
    a.report.auditedAt < b.report.auditedAt ? 1 : -1,
  );

  if (cmd.json) {
    return { exitCode: EXIT_OK, stdout: formatJson({ entries: entries.map((e) => e.report) }) };
  }
  if (entries.length === 0) {
    return { exitCode: EXIT_OK, stdout: "no capability audits recorded yet\n" };
  }
  return { exitCode: EXIT_OK, stdout: `${entries.map(renderEntryLine).join("\n")}\n` };
}
