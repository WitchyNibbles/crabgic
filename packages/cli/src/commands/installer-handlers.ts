/**
 * `install [--dry-run] [--json]`, `upgrade [--dry-run] [--json]`,
 * `uninstall [--keep-state] [--json]` command handlers —
 * roadmap/10-plugin-and-installer.md work items 4–6, wired into 09's
 * command-dispatch shape (`./dispatch.ts`). Each handler is a thin
 * presentation layer over `../installer/{install,upgrade,uninstall}.ts` —
 * no installer logic of its own lives here.
 */
import { EXIT_OK } from "../exit-codes.js";
import { formatJson, type CommandResult } from "../output/format.js";
import { renderHumanReport, renderStatusLine, type HumanReportSection } from "../output/human.js";
import { CLI_TEXT } from "../output/reports.js";

/** The actions worth naming a path for. `unchanged` is this command's passing doctor check. */
const CHANGED_ACTIONS: ReadonlySet<string> = new Set(["create", "update"]);
import { runInstall, type InstallResult } from "../installer/install.js";
import { runUpgrade } from "../installer/upgrade.js";
import { runUninstall } from "../installer/uninstall.js";
import type { InstallerDependencies } from "../installer/types.js";
import type { InstallCommand, UninstallCommand, UpgradeCommand } from "../argv/types.js";

export async function runInstallCommand(
  cmd: InstallCommand,
  installer: InstallerDependencies,
): Promise<CommandResult> {
  const result = await runInstall(installer, { dryRun: cmd.dryRun });
  if (cmd.json) {
    return { exitCode: EXIT_OK, stdout: formatJson(result) };
  }
  // The policy outcome is its own section, not a tail appended after the file
  // list. It is the one thing in an install that decides what runs unattended,
  // and it was previously the last line under nine artifact lines — the
  // position a reader reaches last, if at all.
  const policy = renderPolicyOutcome(result.policy);
  const files = renderFileOutcome(result.diff, CHANGED_ACTIONS);
  return {
    exitCode: EXIT_OK,
    stdout: renderHumanReport(
      {
        lead: renderStatusLine(
          "ok",
          `install: ${result.status} — ${files.summary} (repo: ${result.repoState}).`,
          CLI_TEXT,
        ),
        sections: [
          files.section,
          // `body`, not `bullets`: a bullet is elided at `bulletMaxWords`, and
          // these outcomes run to forty words of consequence ("dispatches will
          // refuse until one exists", "do NOT delete it"). Truncating a safety
          // instruction to fit a scannability budget trades the wrong thing.
          ...(policy !== undefined ? [{ title: "Standing policy", body: policy }] : []),
        ],
      },
      CLI_TEXT,
    ),
  };
}

interface DiffEntryLike {
  readonly action: string;
  readonly relPath: string;
}

/**
 * The file half of an install/upgrade/uninstall report: what CHANGED, listed,
 * and what did not, counted.
 *
 * An unchanged file is this command's equivalent of a passing doctor check — it
 * asks nothing of the reader, and `upgrade` on an up-to-date install emitted
 * NINE of them and nothing else, which is a screen of text conveying one bit.
 * The counts go in the lead so the listed paths read as a sample of a stated
 * total rather than as the whole story, which matters because the section is
 * capped at `sectionMaxBullets` like any other.
 */
function renderFileOutcome(
  entries: readonly DiffEntryLike[],
  changedActions: ReadonlySet<string>,
): { readonly summary: string; readonly section: HumanReportSection } {
  const changed = entries.filter((entry) => changedActions.has(entry.action));
  const unchanged = entries.length - changed.length;

  const byAction = new Map<string, number>();
  for (const entry of changed) byAction.set(entry.action, (byAction.get(entry.action) ?? 0) + 1);
  const parts = [...byAction].map(([action, count]) => `${String(count)} ${action}d`);
  if (unchanged > 0) parts.push(`${String(unchanged)} unchanged`);

  return {
    summary: parts.length > 0 ? parts.join(", ") : "no files touched",
    section: {
      title: "Files",
      bullets: changed.map((entry) => `${entry.action}: ${entry.relPath}`),
      ...(changed.length === 0
        ? { body: "Nothing to change — every managed file already matches." }
        : {}),
    },
  };
}

/**
 * One line about the standing policy (ledger Gap 18).
 *
 * A dry run confirms nothing interactively, so without this it printed the
 * six repo artifacts and said nothing at all about the policy — even though
 * roadmap/10's amendment says `--dry-run` shows it like any other artifact,
 * and the policy is the one thing in an install that decides what runs
 * unattended. Every outcome is reported, including the ones that are not
 * failures, because "no policy was written" is exactly the state an operator
 * must not discover later from a refused dispatch.
 */
function renderPolicyOutcome(outcome: InstallResult["policy"]): string | undefined {
  switch (outcome?.status) {
    case undefined:
    case "not-configured":
      return undefined;
    case "written":
      return renderStatusLine(
        "ok",
        "written outside the repository; run `crabgic doctor` to see what it grants",
        CLI_TEXT,
      );
    case "dry-run":
      return renderStatusLine(
        "info",
        `would be written outside the repository, granting ` +
          `paths [${outcome.policy.allowedPathPrefixes.join(", ") || "none"}] and ` +
          `commands [${outcome.policy.allowedCommands.join(", ") || "none"}]; ` +
          `run without --dry-run to review it in full and confirm`,
        CLI_TEXT,
      );
    case "declined":
      return renderStatusLine(
        "warn",
        "not written (declined); dispatches will refuse until one exists",
        CLI_TEXT,
      );
    case "vacuous":
      return renderStatusLine(
        "warn",
        "not written: nothing in this repository could be granted, " +
          "so it would have refused every run while looking healthy",
        CLI_TEXT,
      );
    case "kept-existing":
      return renderStatusLine(
        "info",
        "already exists and was kept untouched (hand-added grants are never derived, " +
          "so re-authoring would have wiped them); edit the file directly, or " +
          "delete it and re-run `crabgic install` to re-author",
        CLI_TEXT,
      );
    case "existing-invalid":
      // The remedy must agree with the evidence (round 9's rule, applied
      // here by review): a TRANSIENT load failure means the file is probably
      // fine and only this process's state prevented reading it — telling
      // the owner to "fix or delete" it would invite destroying the
      // hand-added grants this guard exists to protect.
      return outcome.transient
        ? renderStatusLine(
            "warn",
            `exists but could not be read right now (${outcome.reason}); ` +
              "kept untouched — the file is probably fine, retry once resources free up; " +
              "do NOT delete it",
            CLI_TEXT,
          )
        : renderStatusLine(
            "warn",
            `exists but cannot be loaded (${outcome.reason}); kept untouched ` +
              "rather than overwritten — fix it by hand, or delete it and re-run `crabgic install`",
            CLI_TEXT,
          );
  }
}

export async function runUpgradeCommand(
  cmd: UpgradeCommand,
  installer: InstallerDependencies,
): Promise<CommandResult> {
  const result = await runUpgrade(installer, { dryRun: cmd.dryRun });
  if (cmd.json) {
    return { exitCode: EXIT_OK, stdout: formatJson(result) };
  }
  // A recovered interrupted upgrade is the one fact here an operator must not
  // miss, so it takes the lead's glyph rather than sitting in a parenthetical.
  const recovered = result.recoveredFromInterruptedUpgrade;
  const files = renderFileOutcome(result.diff, CHANGED_ACTIONS);
  return {
    exitCode: EXIT_OK,
    stdout: renderHumanReport(
      {
        lead: renderStatusLine(
          recovered ? "warn" : "ok",
          `upgrade: ${result.status} — ${files.summary}${recovered ? "; recovered a prior interrupted upgrade" : ""}.`,
          CLI_TEXT,
        ),
        sections: [files.section],
      },
      CLI_TEXT,
    ),
  };
}

export async function runUninstallCommand(
  cmd: UninstallCommand,
  installer: InstallerDependencies,
): Promise<CommandResult> {
  const result = await runUninstall(installer.targetDir, { keepState: cmd.keepState });
  if (cmd.json) {
    return { exitCode: EXIT_OK, stdout: formatJson(result) };
  }
  // `removed` is uninstall's changed action; anything else it reports (a file
  // already absent, one deliberately kept under --keep-state) is a no-op and
  // belongs in the count, not the list.
  const files = renderFileOutcome(result.outcomes, new Set(["removed"]));
  return {
    exitCode: EXIT_OK,
    stdout: renderHumanReport(
      {
        lead: renderStatusLine("ok", `uninstall: ${result.status} — ${files.summary}.`, CLI_TEXT),
        sections: [files.section],
      },
      CLI_TEXT,
    ),
  };
}
