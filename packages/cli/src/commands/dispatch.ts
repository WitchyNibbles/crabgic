/**
 * `ParsedCommand` → `CommandResult` — roadmap/09-cli-and-doctor.md work
 * item 1's failing-first framing: "invoking a command with no backend
 * registered yet returns the exact `NOT_IMPLEMENTED` typed shape, not a
 * crash or an untyped error." Every command name in `../argv/types.ts` has
 * a branch below; `status`/`cancel`/`evidence`/`doctor` delegate to
 * `./real-handlers.ts` unconditionally; `install`/`upgrade`/`uninstall`
 * (roadmap/10-plugin-and-installer.md) delegate to
 * `./installer-handlers.ts` only when `deps.installer` is supplied;
 * everything else returns `notImplementedResult`.
 */
import { EXIT_GENERAL_ERROR, EXIT_SUPERVISOR_UNAVAILABLE } from "../exit-codes.js";
import { SupervisorUnavailableError, toErrorMessage } from "../errors.js";
import type { ParsedCommand } from "../argv/types.js";
import type { CommandResult } from "../output/format.js";
import type { CliDependencies } from "./types.js";
import { notImplementedResult } from "./not-implemented.js";
import {
  runCancelCommand,
  runDoctorCommand,
  runEvidenceCommand,
  runStatusCommand,
} from "./real-handlers.js";
import { runInstallCommand, runUninstallCommand, runUpgradeCommand } from "./installer-handlers.js";
import { renderHelp } from "./help.js";

export async function dispatchCommand(
  command: ParsedCommand,
  deps: CliDependencies,
): Promise<CommandResult> {
  try {
    switch (command.command) {
      case "help":
        return renderHelp(command);
      case "doctor":
        return await runDoctorCommand(command, deps);
      case "status":
        return await runStatusCommand(command, deps);
      case "cancel":
        return await runCancelCommand(command, deps);
      case "evidence":
        return await runEvidenceCommand(command, deps);

      // roadmap/10-plugin-and-installer.md wires these three real backends
      // — but ONLY when `deps.installer` is supplied (kept optional on
      // `CliDependencies` precisely so every pre-existing roadmap/09 test,
      // which never supplies it, keeps observing the exact same typed
      // NOT_IMPLEMENTED shape unchanged).
      case "install":
        return deps.installer !== undefined
          ? await runInstallCommand(command, deps.installer)
          : notImplementedResult(command.command, command.json);
      case "upgrade":
        return deps.installer !== undefined
          ? await runUpgradeCommand(command, deps.installer)
          : notImplementedResult(command.command, command.json);
      case "uninstall":
        return deps.installer !== undefined
          ? await runUninstallCommand(command, deps.installer)
          : notImplementedResult(command.command, command.json);

      // Every command below has no backend wired at this phase's own build
      // time (roadmap/09 §Out of scope names the owning later phase for
      // each) — the typed NOT_IMPLEMENTED shape is the correct, tested
      // behavior here, not a gap.
      case "run":
      case "resume":
      case "connection-add":
      case "connection-list":
      case "connection-doctor":
      case "connection-capabilities":
      case "trust-review":
      case "trust-approve":
      case "trust-revoke":
      case "learn-list":
      case "learn-approve":
      case "learn-reject":
      case "learn-rollback":
        return notImplementedResult(command.command, command.json);

      case "gateway-mcp":
        // `gateway mcp` is a long-running stdio process, never a single
        // CommandResult — `../bin.ts` boots it directly and never routes
        // it through this dispatcher's request/response model.
        return notImplementedResult(
          "gateway mcp is booted directly by bin.ts, never dispatched",
          false,
        );

      default: {
        const exhaustive: never = command;
        return notImplementedResult(String((exhaustive as { command: string }).command), false);
      }
    }
  } catch (err) {
    if (err instanceof SupervisorUnavailableError) {
      return { exitCode: EXIT_SUPERVISOR_UNAVAILABLE, stderr: `${err.message}\n` };
    }
    return { exitCode: EXIT_GENERAL_ERROR, stderr: `${toErrorMessage(err)}\n` };
  }
}
