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
  const lines = result.diff.map(
    (d) => `  ${d.action === "create" ? "+" : d.action === "update" ? "~" : "="} ${d.relPath}`,
  );
  return {
    exitCode: EXIT_OK,
    stdout:
      `install: ${result.status} (repo: ${result.repoState})\n${lines.join("\n")}\n` +
      renderPolicyOutcome(result.policy),
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
function renderPolicyOutcome(outcome: InstallResult["policy"]): string {
  switch (outcome?.status) {
    case undefined:
    case "not-configured":
      return "";
    case "written":
      return `  + standing policy (outside the repository; run \`crabgic doctor\` to see what it grants)\n`;
    case "dry-run":
      return (
        `  + standing policy would be written outside the repository, granting ` +
        `paths [${outcome.policy.allowedPathPrefixes.join(", ") || "none"}] and ` +
        `commands [${outcome.policy.allowedCommands.join(", ") || "none"}]; ` +
        `run without --dry-run to review it in full and confirm\n`
      );
    case "declined":
      return "  ! standing policy not written (declined); dispatches will refuse until one exists\n";
    case "vacuous":
      return (
        "  ! standing policy not written: nothing in this repository could be granted, " +
        "so it would have refused every run while looking healthy\n"
      );
    case "kept-existing":
      return (
        "  = standing policy already exists and was kept untouched (hand-added grants are " +
        "never derived, so re-authoring would have wiped them); edit the file directly, or " +
        "delete it and re-run `crabgic install` to re-author\n"
      );
    case "existing-invalid":
      return (
        `  ! standing policy exists but cannot be loaded (${outcome.reason}); kept untouched ` +
        "rather than overwritten — fix it, or delete it and re-run `crabgic install`\n"
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
  const lines = result.diff.map(
    (d) => `  ${d.action === "create" ? "+" : d.action === "update" ? "~" : "="} ${d.relPath}`,
  );
  return {
    exitCode: EXIT_OK,
    stdout: `upgrade: ${result.status}${result.recoveredFromInterruptedUpgrade ? " (recovered a prior interrupted upgrade)" : ""}\n${lines.join("\n")}\n`,
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
  const lines = result.outcomes.map((o) => `  ${o.action}: ${o.relPath}`);
  return { exitCode: EXIT_OK, stdout: `uninstall: ${result.status}\n${lines.join("\n")}\n` };
}
