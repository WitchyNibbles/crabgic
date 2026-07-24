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
import { runInstall } from "../installer/install.js";
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
    stdout: `install: ${result.status} (repo: ${result.repoState})\n${lines.join("\n")}\n`,
  };
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
