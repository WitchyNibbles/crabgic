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
  pluralize,
  renderItemListReport,
  renderResultLine,
  type CommandResult,
  type TrustReviewCommand,
} from "@crabgic/contracts";
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
    return { exitCode: EXIT_OK, stdout: renderResultLine("info", "no capability audits recorded") };
  }
  // The store grows without bound and every entry carries a digest, so this is
  // the unbounded-list shape — see `docs/presentation-policy.md`. The lead
  // answers the question `trust review` is actually run to answer ("is anything
  // waiting on me?") rather than leaving it to be counted off a column.
  const pending = entries.filter((e) => e.report.decision === "pending").length;
  return {
    exitCode: EXIT_OK,
    stdout: renderItemListReport({
      role: pending > 0 ? "question" : "info",
      lead:
        pending > 0
          ? `${pluralize(entries.length, "audit")}, ${String(pending)} awaiting approval.`
          : `${pluralize(entries.length, "audit")}, none pending.`,
      title: "Audits",
      items: entries.map(renderEntryLine),
    }),
  };
}
